-- 0003_database_roles.sql
-- Database roles the application connects as.
--
-- Supabase provisions `anon`, `authenticated` and `service_role` already. They
-- are created here only so migrations and pgTAP run identically on a plain
-- Postgres instance; `if not exists` makes this a no-op on Supabase.
--
-- Reference: ARCHITECTURE.md §16.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- Matches Supabase: bypasses RLS. It does NOT bypass table grants, which is
    -- what keeps audit_log append-only even for server-side code (0004).
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app to anon, authenticated, service_role;
