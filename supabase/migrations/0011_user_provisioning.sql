-- 0011_user_provisioning.sql
-- First-sign-in provisioning and access-request approval.
-- Reference: ARCHITECTURE.md §15.
--
-- Both operations are SECURITY DEFINER functions rather than direct table
-- writes, for the same reason: the acting user does not yet have (or should not
-- need) the privileges the operation requires. Provisioning runs for a user who
-- has no role at all, and approval must write two tables plus audit_log
-- atomically. Routing them through functions means the application never needs
-- a service_role key to onboard someone, which keeps RLS meaningful.

-- --------------------------------------------------------------------------
-- Allowed sign-in domains.
--
-- Held in the database, not only in configuration: the decision is "pending
-- access for allowed domains only, everything else rejected", and an allowlist
-- that lives solely in an environment variable is one misconfigured deploy away
-- from admitting the public.
-- --------------------------------------------------------------------------
create table allowed_email_domains (
  domain     citext primary key,
  note       text,
  created_at timestamptz not null default now()
);

alter table allowed_email_domains enable row level security;

create policy allowed_email_domains_select on allowed_email_domains
  for select to authenticated using (app.is_active_user());
create policy allowed_email_domains_write on allowed_email_domains
  for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

insert into allowed_email_domains (domain, note) values
  ('plumhq.com', 'Plum Google Workspace'),
  ('bagarka.in', 'Bootstrap Super Admin only — remove once migrated to a plumhq.com identity')
on conflict (domain) do nothing;

create or replace function app.is_allowed_email_domain(p_email citext)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from allowed_email_domains d
    where d.domain = split_part(lower(p_email::text), '@', 2)
  );
$$;

-- --------------------------------------------------------------------------
-- Provision a user on first sign-in.
--
-- Creates the app_users row at status='pending' plus a pending access_request,
-- then consumes a bootstrap Super Admin grant if one is waiting for this
-- address. Idempotent: a returning user just gets their existing row back.
--
-- Rejects any address outside the allowlist outright, before a row exists.
-- --------------------------------------------------------------------------
create or replace function app.provision_signed_in_user(
  p_user_id uuid,
  p_email   citext,
  p_name    text
)
returns table (status app.user_status, role app.user_role)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  existing app_users%rowtype;
begin
  if not app.is_allowed_email_domain(p_email) then
    raise exception 'Sign-in from % is not permitted', split_part(lower(p_email::text), '@', 2)
      using errcode = 'insufficient_privilege';
  end if;

  select * into existing from app_users u where u.id = p_user_id;

  if found then
    return query select existing.status, existing.role;
    return;
  end if;

  -- Guard against the same person arriving with a new auth identity: email is
  -- unique, so this surfaces as a clear error rather than a constraint
  -- violation halfway through onboarding.
  if exists (select 1 from app_users u where u.email = p_email) then
    raise exception 'An account already exists for % under a different sign-in identity', p_email
      using errcode = 'unique_violation';
  end if;

  insert into app_users (id, email, name, status)
  values (p_user_id, p_email, coalesce(nullif(trim(p_name), ''), split_part(p_email::text, '@', 1)), 'pending');

  insert into access_requests (requested_by, status)
  values (p_user_id, 'pending');

  insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
  values ('app_users', p_user_id::text, 'user_provisioned', 'system', null, null,
          jsonb_build_object('email', p_email::text, 'status', 'pending'));

  -- A waiting bootstrap grant promotes this user immediately (see ADR 0002).
  perform app.consume_bootstrap_super_admin(p_user_id, p_email);

  return query
    select u.status, u.role from app_users u where u.id = p_user_id;
end;
$$;

-- --------------------------------------------------------------------------
-- Approve or reject an access request (§15).
--
-- Admin and Super Admin may both approve. An Admin may not mint a Super Admin:
-- §15 reserves user provisioning at that level to Super Admin.
-- --------------------------------------------------------------------------
create or replace function app.decide_access_request(
  p_request_id uuid,
  p_approve    boolean,
  p_role       app.user_role default null,
  p_manager_id uuid default null,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  req    access_requests%rowtype;
  target app_users%rowtype;
  actor  uuid := app.current_user_id();
begin
  if not app.can_approve_access_requests() then
    raise exception 'Only an Admin or Super Admin may decide access requests'
      using errcode = 'insufficient_privilege';
  end if;

  select * into req from access_requests where id = p_request_id for update;
  if not found then
    raise exception 'Access request % not found', p_request_id using errcode = 'no_data_found';
  end if;
  if req.status <> 'pending' then
    raise exception 'Access request % has already been decided', p_request_id
      using errcode = 'invalid_parameter_value';
  end if;

  select * into target from app_users where id = req.requested_by;

  if p_approve then
    if p_role is null then
      raise exception 'A role must be assigned when approving (§15)'
        using errcode = 'invalid_parameter_value';
    end if;
    if p_role = 'super_admin' and not app.is_super_admin() then
      raise exception 'Only a Super Admin may grant the Super Admin role'
        using errcode = 'insufficient_privilege';
    end if;
    -- A manager is what makes span computable, so it is required for the roles
    -- whose visibility is defined by position in the hierarchy.
    if p_manager_id is null and p_role in ('consultant', 'manager') then
      raise exception 'A manager must be assigned for the % role' , p_role
        using errcode = 'invalid_parameter_value';
    end if;

    update app_users
       set role = p_role, manager_id = p_manager_id, status = 'active'
     where id = req.requested_by;

    update access_requests
       set status = 'approved', assigned_role = p_role, assigned_manager_id = p_manager_id,
           approved_by = actor, decided_at = now(), decision_note = p_note
     where id = p_request_id;

    insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
    values ('app_users', req.requested_by::text, 'access_request_approved', 'user', actor,
            jsonb_build_object('role', target.role, 'status', target.status, 'manager_id', target.manager_id),
            jsonb_build_object('role', p_role, 'status', 'active', 'manager_id', p_manager_id));
  else
    update access_requests
       set status = 'rejected', approved_by = actor, decided_at = now(), decision_note = p_note
     where id = p_request_id;

    insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
    values ('access_requests', p_request_id::text, 'access_request_rejected', 'user', actor,
            jsonb_build_object('status', 'pending'),
            jsonb_build_object('status', 'rejected', 'note', p_note));
  end if;
end;
$$;

grant execute on function
  app.provision_signed_in_user(uuid, citext, text),
  app.decide_access_request(uuid, boolean, app.user_role, uuid, text),
  app.is_allowed_email_domain(citext)
to authenticated, service_role;
