-- 0018_bootstrap_self_approval_fix.sql
-- Fixes a way the first Super Admin could lock themselves out.
--
-- What went wrong
-- ---------------
-- app.provision_signed_in_user() creates an app_users row AND a pending
-- access_request, then consumes a bootstrap grant if one is waiting. The grant
-- promoted the user to Super Admin — but nothing resolved the access request it
-- had just created.
--
-- So the new Super Admin landed on the approvals queue and found their own
-- request sitting in it, apparently needing a decision. Approving it called
-- decide_access_request, which set their role to whatever was chosen — and any
-- choice other than Super Admin demoted them out of the role the bootstrap had
-- just granted.
--
-- If the chosen role was not an approver, they then lost the approvals screen
-- as well, and with it the ability to approve anyone else. The system had one
-- Super Admin, and the first screen they saw invited them to stop being one.
--
-- Three changes: resolve the request when the grant is consumed, refuse
-- self-decisions outright, and repair anyone already affected.

-- --------------------------------------------------------------------------
-- 1. Consuming a bootstrap grant resolves the access request it created.
-- --------------------------------------------------------------------------
create or replace function app.consume_bootstrap_super_admin(p_user_id uuid, p_email citext)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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

  -- The access request raised moments ago by provisioning is now answered: the
  -- grant IS the decision. Leaving it pending is what put the Super Admin's own
  -- request in front of them as if it still needed deciding.
  --
  -- approved_by is the user themselves because the constraint requires an
  -- approver and this grant has no other actor; the note says plainly that it
  -- was a bootstrap, so the row is not mistaken for a real self-approval.
  update access_requests
     set status = 'approved',
         assigned_role = 'super_admin',
         approved_by = p_user_id,
         decided_at = now(),
         decision_note = 'Granted automatically by a bootstrap Super Admin seed, not by a human approver.'
   where requested_by = p_user_id
     and status = 'pending';

  update bootstrap_super_admins
     set consumed_at = now(), consumed_by = p_user_id
   where email = p_email;

  insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
  values (
    'app_users', p_user_id::text, 'bootstrap_super_admin_granted', 'system', null,
    jsonb_build_object('role', null, 'status', 'pending'),
    jsonb_build_object('role', 'super_admin', 'status', 'active', 'email', p_email::text)
  );

  return true;
end;
$$;

alter function app.consume_bootstrap_super_admin(uuid, citext) owner to postgres;

-- --------------------------------------------------------------------------
-- 2. Nobody decides their own access request.
--
-- Worth refusing on principle even with the fix above: a person setting their
-- own role is the shape of a privilege escalation, and there is no legitimate
-- case for it. If a Super Admin's own access genuinely needs changing, another
-- Super Admin does it.
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

  if req.requested_by = actor then
    raise exception 'You cannot decide your own access request — ask another Super Admin'
      using errcode = 'insufficient_privilege';
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
    if p_manager_id is null and p_role in ('consultant', 'manager') then
      raise exception 'A manager must be assigned for the % role', p_role
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

-- --------------------------------------------------------------------------
-- 3. Repair anyone already caught by this.
--
-- Scoped precisely to users who consumed a bootstrap grant — that is recorded
-- in bootstrap_super_admins.consumed_by, so this cannot touch anybody else. A
-- bootstrap grant is a standing statement that this person is the Super Admin;
-- restoring it is putting back what the grant said, not inventing access.
-- --------------------------------------------------------------------------
do $$
declare
  repaired int := 0;
  r record;
begin
  for r in
    select b.consumed_by as user_id, u.role, u.status
    from bootstrap_super_admins b
    join app_users u on u.id = b.consumed_by
    where b.consumed_by is not null
      and (u.role is distinct from 'super_admin' or u.status <> 'active')
  loop
    update app_users
       set role = 'super_admin', status = 'active'
     where id = r.user_id;

    insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
    values ('app_users', r.user_id::text, 'bootstrap_super_admin_restored', 'system', null,
            jsonb_build_object('role', r.role, 'status', r.status),
            jsonb_build_object('role', 'super_admin', 'status', 'active',
                               'reason', 'Self-approval demoted the bootstrap Super Admin; see migration 0018'));
    repaired := repaired + 1;
  end loop;

  -- And close any access request still sitting pending against them.
  update access_requests ar
     set status = 'approved',
         assigned_role = 'super_admin',
         approved_by = ar.requested_by,
         decided_at = now(),
         decision_note = 'Resolved by migration 0018: this account holds a bootstrap Super Admin grant.'
   where ar.status = 'pending'
     and ar.requested_by in (select consumed_by from bootstrap_super_admins where consumed_by is not null);

  if repaired > 0 then
    raise notice 'Restored Super Admin to % bootstrap account(s)', repaired;
  end if;
end
$$;
