-- 0007_rls_helpers.sql
-- Helper functions backing the §15 role/span model.
--
-- All are SECURITY DEFINER with a pinned search_path: they read app_users,
-- which itself has RLS enabled, so an INVOKER-rights function would recurse.
-- They are STABLE, so Postgres evaluates each once per statement rather than
-- once per row.

-- --------------------------------------------------------------------------
-- Identity of the current actor.
-- --------------------------------------------------------------------------
create or replace function app.current_role()
returns app.user_role
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select u.role
  from app_users u
  where u.id = app.current_user_id()
    and u.status = 'active';
$$;

comment on function app.current_role() is
  'Role of the signed-in user, or null if unauthenticated, pending or suspended. A null role denies everything: a suspended user is indistinguishable from an anonymous one.';

create or replace function app.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from app_users u
    where u.id = app.current_user_id() and u.status = 'active'
  );
$$;

-- --------------------------------------------------------------------------
-- Span: the current user plus their entire reporting subtree, at any depth.
--
-- Per the M0 decision, Leader and Head of Department see their full subtree,
-- not the whole organisation; organisation-wide read is what Admin is for.
-- Manager uses the same walk. Cycles are prevented by the trigger in 0002; the
-- depth cap here is a second line of defence, not the primary guard.
-- --------------------------------------------------------------------------
create or replace function app.span_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with recursive subtree as (
    select u.id, 0 as depth
    from app_users u
    where u.id = app.current_user_id()
    union all
    select child.id, parent.depth + 1
    from app_users child
    join subtree parent on child.manager_id = parent.id
    where parent.depth < 64
  )
  select id from subtree;
$$;

comment on function app.span_user_ids() is
  'Current user + full reporting subtree. Recomputed per statement; if this becomes a hot path, materialise it as a closure table refreshed on manager_id change — the RLS policies will not need to change.';

-- --------------------------------------------------------------------------
-- The §15 matrix, expressed once.
-- --------------------------------------------------------------------------

-- Admin and Super Admin see every deal.
create or replace function app.can_read_all_cases()
returns boolean
language sql
stable
as $$
  select app.current_role() in ('admin', 'super_admin');
$$;

-- Read a case: own, or in span (Manager/Leader/HoD), or everything.
create or replace function app.can_read_case(owner uuid)
returns boolean
language sql
stable
as $$
  select case app.current_role()
    when 'consultant'         then owner = app.current_user_id()
    when 'manager'            then owner in (select app.span_user_ids())
    when 'leader'             then owner in (select app.span_user_ids())
    when 'head_of_department' then owner in (select app.span_user_ids())
    when 'admin'              then true
    when 'super_admin'        then true
    else false
  end;
$$;

-- Transact on a case. Leader, HoD and Admin are read-only by design (§15).
--
-- Manager is scoped to their OWN deals here, matching the "Can transact (own
-- deals)" column literally. See docs/decisions/0004-manager-write-scope.md —
-- this is the conservative reading and is flagged for confirmation.
create or replace function app.can_write_case(owner uuid)
returns boolean
language sql
stable
as $$
  select case app.current_role()
    when 'consultant'  then owner = app.current_user_id()
    when 'manager'     then owner = app.current_user_id()
    when 'super_admin' then true
    else false
  end;
$$;

-- Guardrails reference data (§4.3) is CRUD for Admin, and for Super Admin as
-- part of full system configuration. Everyone else reads it.
create or replace function app.can_write_reference_data()
returns boolean
language sql
stable
as $$
  select app.current_role() in ('admin', 'super_admin');
$$;

-- Approving an access request assigns role and manager to a PENDING user.
-- §15 gives this to Admin and Super Admin. Managing an already-active user
-- (role change, suspension) is user provisioning, which §15 reserves to
-- Super Admin — enforced in the app_users policies, not here.
create or replace function app.can_approve_access_requests()
returns boolean
language sql
stable
as $$
  select app.current_role() in ('admin', 'super_admin');
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
as $$
  select app.current_role() = 'super_admin';
$$;

-- Owner of a case, for policies on descendant tables.
create or replace function app.case_owner(p_case_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.owner_user_id from cases c where c.id = p_case_id;
$$;
