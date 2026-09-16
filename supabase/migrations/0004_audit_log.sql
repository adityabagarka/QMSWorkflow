-- 0004_audit_log.sql
-- Immutable, append-only audit log.
-- Reference: ARCHITECTURE.md §4.2, §16.
--
-- Deliberately created before the entities that write to it, so that no table
-- can be added later that quietly skips auditing.

create table audit_log (
  id           bigint generated always as identity primary key,
  entity_type  text not null,
  entity_id    text not null,
  action       text not null,
  actor_type   app.actor_type not null,
  actor_id     uuid references app_users (id) on delete restrict,
  before       jsonb,
  after        jsonb,
  occurred_at  timestamptz not null default now(),

  -- "actor" in §4.2 is a user or "system". Split into two columns so a system
  -- action is unambiguous rather than being a magic user id.
  constraint audit_log_actor_is_resolvable check (
    (actor_type = 'user'   and actor_id is not null) or
    (actor_type = 'system' and actor_id is null)
  )
);

comment on table audit_log is
  'Append-only. No UPDATE or DELETE is permitted to any application role, including Super Admin (§16). Break-glass requires disabling the guard trigger as a separate, out-of-band, logged operation.';

create index audit_log_entity_idx on audit_log (entity_type, entity_id, occurred_at desc);
create index audit_log_actor_idx on audit_log (actor_id, occurred_at desc);
create index audit_log_occurred_at_idx on audit_log (occurred_at desc);

-- --------------------------------------------------------------------------
-- Append-only enforcement, belt and braces.
--
-- 1. Grants: revoked below (0009) from every application role. This stops the
--    app and service_role, but not a superuser.
-- 2. Trigger: stops a superuser too, including `postgres`. This is the real
--    teeth. Disabling it is DDL, which is itself visible in the server log.
-- --------------------------------------------------------------------------
create or replace function app.reject_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only (ARCHITECTURE.md §16); % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_no_update
  before update on audit_log
  for each row execute function app.reject_audit_log_mutation();

create trigger audit_log_no_delete
  before delete on audit_log
  for each row execute function app.reject_audit_log_mutation();

create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function app.reject_audit_log_mutation();
