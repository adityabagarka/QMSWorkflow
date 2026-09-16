-- 0010_bootstrap_super_admin.sql
-- One-time bootstrap of the first Super Admin.
--
-- The problem: §15 requires an Admin or Super Admin to approve every new user,
-- but at first deploy nobody exists to do the approving.
--
-- The solution is deliberately NOT a seeded app_users row: app_users.id must
-- equal the Supabase Auth user id, which does not exist until that person
-- signs in for the first time, so seeding one would mean inventing a UUID that
-- never matches a real session. Instead we seed the INTENT. The sign-in
-- handler consumes it exactly once, creating a real, active Super Admin bound
-- to the real auth id, and writes the event to audit_log.

create table bootstrap_super_admins (
  email       citext primary key,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by uuid references app_users (id) on delete restrict
);

comment on table bootstrap_super_admins is
  'Single-use grants of the initial Super Admin role. Environment-specific: review before any new deployment, and expect this table to be empty in production once the first real Super Admin exists.';

alter table bootstrap_super_admins enable row level security;

-- Only a Super Admin can see or manage this table through the app. The
-- sign-in handler reads it server-side via the security-definer function below,
-- before the signing-in user has any role at all.
create policy bootstrap_super_admins_super_admin on bootstrap_super_admins
  for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

revoke update, delete, truncate on bootstrap_super_admins from authenticated, service_role;

-- --------------------------------------------------------------------------
-- Consume the bootstrap grant, if one is pending for this email.
-- Returns true when the caller was promoted to Super Admin.
-- --------------------------------------------------------------------------
create or replace function app.consume_bootstrap_super_admin(p_user_id uuid, p_email citext)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  granted boolean := false;
begin
  -- FOR UPDATE SKIP LOCKED: two concurrent first sign-ins must not both win.
  perform 1
  from bootstrap_super_admins b
  where b.email = p_email and b.consumed_at is null
  for update skip locked;

  if not found then
    return false;
  end if;

  update app_users
     set role = 'super_admin', status = 'active'
   where id = p_user_id;

  update bootstrap_super_admins
     set consumed_at = now(), consumed_by = p_user_id
   where email = p_email;

  granted := true;

  insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
  values (
    'app_users', p_user_id::text, 'bootstrap_super_admin_granted', 'system', null,
    jsonb_build_object('role', null, 'status', 'pending'),
    jsonb_build_object('role', 'super_admin', 'status', 'active', 'email', p_email::text)
  );

  return granted;
end;
$$;

-- bootstrap_super_admins is itself append-only to the app, so the function
-- above needs its own privilege to mark a grant consumed.
alter function app.consume_bootstrap_super_admin(uuid, citext) owner to postgres;

-- --------------------------------------------------------------------------
-- Staging seed. Environment-specific — see .env.example.
--
-- NOTE: bagarka.in is not the Plum Workspace domain, so it must also appear in
-- ALLOWED_EMAIL_DOMAINS or this account will be rejected at sign-in before it
-- can ever consume the grant.
-- --------------------------------------------------------------------------
insert into bootstrap_super_admins (email)
values ('aditya@bagarka.in')
on conflict (email) do nothing;
