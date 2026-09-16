-- 0002_users_and_access_requests.sql
-- Identity, the reporting hierarchy, and the onboarding queue.
-- Reference: ARCHITECTURE.md §4.2, §15.

-- --------------------------------------------------------------------------
-- users
--
-- `id` is the Supabase Auth user id (auth.users.id), not a separate surrogate,
-- so RLS can compare app.current_user_id() to users.id without a join.
-- The org hierarchy here is deliberately NOT sourced from Salesforce (§15).
-- --------------------------------------------------------------------------
create table app_users (
  id            uuid primary key,
  email         citext not null unique,
  name          text not null,
  role          app.user_role,
  manager_id    uuid references app_users (id) on delete restrict,
  status        app.user_status not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A pending user has not been assigned a role yet; an active one must have
  -- been. This is what makes the §15 matrix total: every active user has
  -- exactly one role, so no policy needs a null-role branch.
  constraint app_users_active_has_role
    check (status <> 'active' or role is not null),

  constraint app_users_not_own_manager
    check (manager_id is null or manager_id <> id)
);

comment on table app_users is
  'All system users. Named app_users, not users, to avoid colliding with Supabase auth.users.';
comment on column app_users.manager_id is
  'Reporting line maintained in this system (§15). Span for Manager/Leader/HoD is a walk of this column, never a Salesforce role field.';

create index app_users_manager_id_idx on app_users (manager_id);
create index app_users_role_status_idx on app_users (role, status);

-- --------------------------------------------------------------------------
-- Cycle guard.
--
-- A cycle in manager_id would make the recursive span walk non-terminating
-- (or, with a depth cap, silently wrong). A CHECK constraint cannot see other
-- rows, so this is enforced by trigger.
-- --------------------------------------------------------------------------
create or replace function app.assert_no_manager_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.manager_id;
  hops int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'manager_id cycle: user % cannot report (transitively) to itself', new.id
        using errcode = 'check_violation';
    end if;
    hops := hops + 1;
    if hops > 64 then
      raise exception 'manager_id chain exceeds 64 levels; refusing to continue'
        using errcode = 'check_violation';
    end if;
    select manager_id into cursor_id from app_users where id = cursor_id;
  end loop;
  return new;
end;
$$;

create trigger app_users_no_manager_cycle
  before insert or update of manager_id on app_users
  for each row execute function app.assert_no_manager_cycle();

-- --------------------------------------------------------------------------
-- access_requests (§15)
--
-- Flow: a first-time Google Workspace sign-in from an allowed domain creates
-- an app_users row at status='pending' AND a pending access_request. An Admin
-- or Super Admin approves, assigning role and manager at that moment.
--
-- requested_role is nullable and advisory only: per the M0 decision, role is
-- Admin-assigned, not self-selected. The column is kept because §4.2 names it
-- and because self-service role hints may be enabled later without migration.
-- --------------------------------------------------------------------------
create table access_requests (
  id                  uuid primary key default gen_random_uuid(),
  requested_by        uuid not null references app_users (id) on delete cascade,
  requested_role      app.user_role,
  assigned_role       app.user_role,
  assigned_manager_id uuid references app_users (id) on delete restrict,
  status              app.access_request_status not null default 'pending',
  approved_by         uuid references app_users (id) on delete restrict,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- An approval must say what was granted and by whom; a rejection must not
  -- grant anything. Partially-filled decisions are the failure mode here.
  constraint access_requests_approved_is_complete check (
    status <> 'approved'
    or (assigned_role is not null and approved_by is not null and decided_at is not null)
  ),
  constraint access_requests_rejected_grants_nothing check (
    status <> 'rejected'
    or (assigned_role is null and assigned_manager_id is null
        and approved_by is not null and decided_at is not null)
  ),
  constraint access_requests_pending_is_undecided check (
    status <> 'pending'
    or (approved_by is null and decided_at is null
        and assigned_role is null and assigned_manager_id is null)
  )
);

-- At most one open request per user: re-signing in must not queue duplicates.
create unique index access_requests_one_pending_per_user
  on access_requests (requested_by)
  where status = 'pending';

create index access_requests_status_created_idx on access_requests (status, created_at desc);

-- --------------------------------------------------------------------------
-- updated_at maintenance
-- --------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_users_touch_updated_at
  before update on app_users
  for each row execute function app.touch_updated_at();

create trigger access_requests_touch_updated_at
  before update on access_requests
  for each row execute function app.touch_updated_at();
