# 0005 — Why not Vercel + Neon

**Status:** accepted (M0)
**Relates to:** ARCHITECTURE.md §3.1, §16, §18.1

## The question

Vercel + Neon Postgres is the stack used on another project here. Should this
one match it?

## Decision

No — stay on Supabase for this project. Neon is a good database and the pairing
is a normal, popular choice; one project-specific requirement rules it out.

## Reason 1: Neon has no India region (decisive)

§16 requires India-only hosting: "must be an India data-center region regardless
of provider", driven by the DPDP Act 2023 and IRDAI data-handling norms.

Neon's supported regions are N. Virginia, Ohio, Oregon, Frankfurt, London,
Singapore, Sydney and São Paulo, plus three Azure regions that are being
deprecated. There is no `ap-south-1` (Mumbai) and no Azure India region. The
nearest option is Singapore.

A Mumbai region on the staging database is not itself the compliance posture
§16 demands — §3.1 is explicit that a Mumbai function region and a certified
posture are not the same thing. But it keeps the project inside the right
jurisdiction by default. CLAUDE.md forbids real PII/PHI in staging at every
milestone; if that rule is ever breached by accident, a Mumbai database is a
mistake, whereas a Singapore database is a cross-border transfer incident.

## Reason 2: Neon is a database only, so login must be rebuilt

Supabase bundles the Google Workspace sign-in required by §15 and §16. Neon
does not — it is Postgres and nothing else. Switching means adding a separate
authentication library and rewriting the sign-in flow, the callback, the
session handling and the middleware.

## Reason 3: RLS is easier to get wrong on a plain Postgres connection

§15 requires the database, not the application, to enforce who can see which
deals. Both providers run real Postgres, so the policies themselves are
identical.

The difference is how the database learns who is asking. Supabase passes the
signed-in user automatically with every query. On Neon the application must set
that identity on each connection by hand, inside a transaction — and if the
application connects as the role that owns the tables, Postgres skips row-level
security entirely by default. That is a quiet failure: everything appears to
work while every user can read every deal. It is avoidable, but it is an easy
mistake to make and an expensive one to make here.

## What switching would actually cost

The database is portable and was built that way deliberately. All eleven
migrations are plain SQL, and `app.current_user_id()` reads a standard Postgres
setting rather than calling Supabase's `auth.uid()` (see ADR 0001), so the
schema, the RLS policies and all 67 tests run on stock Postgres today — they
were developed against a local PostgreSQL instance, not against Supabase.

So roughly two thirds of M0 would move unchanged. The sign-in layer would be
rewritten. The residency problem would remain, and is the reason this is a no.

## When to revisit

- If Neon adds an India region **and** the §18.1 cloud decision lands somewhere
  that makes Neon the natural production home.
- Production is planned as RDS or Cloud SQL in an India region regardless
  (§3.1), so neither Supabase nor Neon is the long-term destination. This
  decision is about which staging environment throws away the least work.

## Sources

- Neon supported regions:
  https://github.com/neondatabase/website/blob/main/content/docs/introduction/regions.md
