-- 0019_decide_user_access.sql
-- Approve or reject a PERSON, not a request row.
--
-- The approvals queue was built on access_requests. That assumed one invariant:
-- a pending user always has exactly one pending request. Migration 0018 exists
-- because that invariant had already broken once — the bootstrap grant left a
-- stale request — and when it breaks, the person disappears from the queue with
-- no trace and no way to act on them. They are simply stuck, and nobody can see
-- why.
--
-- The durable fact is `app_users.status = 'pending'`: this person is waiting.
-- The request row is supporting detail — who asked, when, what note. So the
-- queue is now derived from users, and this function acts on a user, creating
-- or resolving the request row as needed rather than depending on it.

create or replace function app.decide_user_access(
  p_user_id    uuid,
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
  target     app_users%rowtype;
  actor      uuid := app.current_user_id();
  request_id uuid;
begin
  if not app.can_approve_access_requests() then
    raise exception 'Only an Admin or Super Admin may decide access'
      using errcode = 'insufficient_privilege';
  end if;

  select * into target from app_users where id = p_user_id for update;
  if not found then
    raise exception 'No such user' using errcode = 'no_data_found';
  end if;

  if p_user_id = actor then
    raise exception 'You cannot decide your own access — ask another Super Admin'
      using errcode = 'insufficient_privilege';
  end if;

  if target.status <> 'pending' then
    raise exception 'Access for % has already been decided', target.email
      using errcode = 'invalid_parameter_value';
  end if;

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
    if p_manager_id = p_user_id then
      raise exception 'A user cannot be their own manager'
        using errcode = 'invalid_parameter_value';
    end if;

    update app_users
       set role = p_role, manager_id = p_manager_id, status = 'active'
     where id = p_user_id;
  else
    update app_users set status = 'suspended' where id = p_user_id;
  end if;

  -- Resolve the request if there is one; create a resolved one if there is not,
  -- so the decision is recorded either way and the queue cannot show this
  -- person again.
  select id into request_id
  from access_requests
  where requested_by = p_user_id and status = 'pending'
  order by created_at desc
  limit 1;

  if request_id is null then
    insert into access_requests
      (requested_by, status, assigned_role, assigned_manager_id, approved_by, decided_at, decision_note)
    values (
      p_user_id,
      (case when p_approve then 'approved' else 'rejected' end)::app.access_request_status,
      case when p_approve then p_role end,
      case when p_approve then p_manager_id end,
      actor, now(),
      coalesce(p_note, 'Decided from the people list; no pending request row existed.')
    );
  else
    update access_requests
       set status = (case when p_approve then 'approved' else 'rejected' end)::app.access_request_status,
           assigned_role = case when p_approve then p_role end,
           assigned_manager_id = case when p_approve then p_manager_id end,
           approved_by = actor,
           decided_at = now(),
           decision_note = p_note
     where id = request_id;
  end if;

  insert into audit_log (entity_type, entity_id, action, actor_type, actor_id, before, after)
  values (
    'app_users', p_user_id::text,
    case when p_approve then 'access_approved' else 'access_rejected' end,
    'user', actor,
    jsonb_build_object('role', target.role, 'status', target.status, 'manager_id', target.manager_id),
    case when p_approve
      then jsonb_build_object('role', p_role, 'status', 'active', 'manager_id', p_manager_id)
      else jsonb_build_object('status', 'suspended')
    end
  );
end;
$$;

create or replace function public.decide_user_access(
  p_user_id    uuid,
  p_approve    boolean,
  p_role       text default null,
  p_manager_id uuid default null,
  p_note       text default null
)
returns void
language sql
as $$
  select app.decide_user_access(
    p_user_id, p_approve, nullif(p_role, '')::app.user_role, p_manager_id, p_note
  );
$$;

revoke all on function public.decide_user_access(uuid, boolean, text, uuid, text) from public;
grant execute on function public.decide_user_access(uuid, boolean, text, uuid, text)
  to authenticated, service_role;

grant execute on function
  app.decide_user_access(uuid, boolean, app.user_role, uuid, text)
to authenticated, service_role;
