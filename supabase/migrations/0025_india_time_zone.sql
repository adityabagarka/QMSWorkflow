-- ════════════════════════════════════════════════════════════════════════════
-- 0025 — India time for the database session.
--
-- The business runs in India. Instants are already stored correctly: every
-- column is `timestamptz`, which is an absolute moment with no zone of its own,
-- so nothing here changes what is recorded or needs any data rewritten.
--
-- What this changes is the zone Postgres RENDERS and REASONS in when a session
-- has not said otherwise. That matters in three places:
--
--   * `now()::date`, `date_trunc('day', ...)` and any `age()` — none of which
--     this schema uses yet, but §11's reminder cascade is date arithmetic on
--     inception, and getting it wrong by the UTC/IST half-day is exactly the
--     bug that makes a reminder fire a day late.
--   * Anything read straight out of `psql` or the Supabase SQL editor while
--     investigating an audit trail. A `timestamptz` prints in the session's
--     zone; with the default of UTC, an entry written at 11pm in Mumbai prints
--     under the previous date, and whoever is reading draws the wrong
--     conclusion about the order of events.
--   * A `timestamp without time zone` literal cast to `timestamptz`, which is
--     interpreted in the session zone. There are none today, and this makes the
--     assumption behind that safe rather than accidental.
--
-- The application layer does not rely on this — `src/lib/format.ts` pins
-- Asia/Kolkata explicitly, because a Vercel function's zone is UTC and is not
-- ours to set. Two independent guarantees for the same rule is deliberate: this
-- one is for humans reading the database directly.
-- ════════════════════════════════════════════════════════════════════════════

-- Per-role rather than `alter database`: on Supabase the database is shared
-- with the platform's own machinery, and the roles below are the ones this
-- application connects as. `alter role ... in database` would be tighter still,
-- but requires naming the database, which differs between Supabase and the
-- local Postgres the tests run against.
do $$
declare
  r text;
begin
  foreach r in array array['authenticated', 'anon', 'service_role', 'postgres'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter role %I set timezone to %L', r, 'Asia/Kolkata');
    end if;
  end loop;
end;
$$;

-- Takes effect on the next connection, so say it for this one too — otherwise
-- anything later in this migration run still reasons in UTC.
set timezone to 'Asia/Kolkata';
