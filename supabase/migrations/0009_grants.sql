-- 0009_grants.sql
-- Table privileges. RLS decides which ROWS a user sees; grants decide which
-- OPERATIONS are possible at all. Both are needed: RLS alone cannot make a
-- table append-only, and service_role bypasses RLS but not grants.
--
-- Reference: ARCHITECTURE.md §16.

-- Nothing is implicitly public.
revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon;

-- `anon` is the unauthenticated surface. In M0 there is no public page, so it
-- gets nothing. M6's token-gated quote page (§13) will grant narrowly, through
-- a security-definer function rather than direct table access.

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- --------------------------------------------------------------------------
-- audit_log: append-only for every application role, Super Admin's
-- application account included (§16). Break-glass is an out-of-band,
-- separately logged process, not a grant.
-- --------------------------------------------------------------------------
revoke update, delete, truncate on audit_log from authenticated, service_role, anon;

-- --------------------------------------------------------------------------
-- Other append-only tables.
--   policy_extraction_edits — the fine-tuning signal; corrections append (§8).
--   burn_calculations       — every run is retained so history stays
--                             reproducible (§10).
--   case_events             — the case timeline (§4.2).
--   member_data_exclusions  — evidence, per rule F-04.
-- --------------------------------------------------------------------------
revoke update, delete, truncate on policy_extraction_edits from authenticated, service_role;
revoke update, delete, truncate on burn_calculations       from authenticated, service_role;
revoke update, delete, truncate on case_events             from authenticated, service_role;
revoke update, delete, truncate on member_data_exclusions  from authenticated, service_role;

-- Users are suspended, never deleted (keeps audit actors resolvable).
revoke delete, truncate on app_users from authenticated, service_role;

-- Anything created by later migrations inherits the same baseline.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
