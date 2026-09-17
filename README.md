# Rollover Quote Management System

Internal system for Plum's rollover quote workflow. `ARCHITECTURE.md` is the
source of truth for the data model, module specs, roles and security
requirements; `CLAUDE.md` carries scope and conventions.

## Status: M0 — Foundation, complete

Signed off on 17 September 2026: deployed to Supabase `ap-south-1`, signed in
through Google Workspace SSO, and an access request approved through the UI.

| Piece                                   | State                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Repo scaffolding (Next.js + TypeScript) | done                                                 |
| Core DB schema (§4.2)                   | done — 43 tables, live                               |
| RLS for the role/span model (§15)       | done — 79 assertions, run against the live database  |
| Append-only `audit_log` (§16)           | done                                                 |
| Guardrails workbook import (§4.3)       | done — 1,440 plans, 83,520 coverage rows, idempotent |
| Google Workspace SSO (OIDC)             | done — signed in end to end                          |
| `access_requests` onboarding flow (§15) | done — approval exercised in the UI                  |

Deployment is by hand from the Actions tab ("Deploy to Supabase staging"), not
on push: it writes to a real database, so it should be a deliberate act. The
assertions run against that database as part of it, so a deploy that would break
the §15 guarantees fails rather than lands.

Nothing beyond M0 has been started.

### Open before the next milestones

- **Salesforce sync is deferred**, not blocking: deals and customer profiles are
  entered by hand first, so §18.4's field mapping is only needed when the sync
  itself is built.
- **M4** needs the workflow orchestrator decision (§18.3, Temporal recommended).
- **The Plum logo is loaded from `app.plumhq.com`** by design, so a rebrand
  reaches this app without a deploy. It falls back to a wordmark if that URL
  ever moves. See `src/components/masthead.tsx`.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL at minimum

npm run db:migrate             # apply supabase/migrations in order
npm run db:test                # prove the §15 role/span model (pgTAP)
npm run db:import-guardrails   # load the reference workbook

npm run dev                    # needs the Supabase and Google values below
```

### What deployment still needs

**If you are not an engineer, follow `docs/SETUP.md` instead of this section —
it is the same thing written as step-by-step instructions.**

The application code is finished but has only been run against local Postgres.
To stand it up on staging:

1. A Supabase project in `ap-south-1`, with its URL and anon key in
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Google OAuth client credentials, entered in the Supabase dashboard under
   Authentication → Providers → Google, with
   `https://<project>.supabase.co/auth/v1/callback` as an authorised redirect
   URI. The credentials go in the dashboard, never in this repository (§16).
3. `npm run db:migrate` and `npm run db:import-guardrails` against that project.

The first sign-in from `aditya@bagarka.in` becomes the Super Admin
(`docs/decisions/0002-bootstrap-super-admin.md`), who can then approve everyone
else.

`npm run db:migrate -- --reset` drops and rebuilds the schema. It refuses to run
with `NODE_ENV=production`.

## Layout

```
supabase/migrations/   numbered SQL, applied in order, one transaction each
supabase/tests/        pgTAP suites — the §15 model is proved here, not in the app
scripts/               migration runner, pgTAP runner, workbook importer
src/                   Next.js app (App Router)
docs/decisions/        ADRs, one per decision that a future reader will question
data/reference/        the guardrails workbook, imported as-is
```

## Things worth knowing before you change anything

**The database enforces permissions, not the application.** §15 requires that a
bug in an application-layer permission check cannot leak cross-user deal data.
Every table that hangs off a case has RLS policies keyed off `cases.owner_user_id`
and a walk of the `app_users.manager_id` hierarchy. If you add a table in M1–M7,
add it to the `descendants` array in `0008_rls_policies.sql` — it will otherwise
have RLS disabled and be readable by everyone.

**Schema changes are plain SQL, not an ORM.** Migrations must `pg_dump`/
`pg_restore` cleanly into RDS or Cloud SQL later (§3.1). Never edit an applied
migration; the runner will refuse it. Add a new one.

**`audit_log` is append-only.** Enforced by revoked grants _and_ a trigger, so
not even a superuser can rewrite it (§16). The same applies to `case_events`,
`burn_calculations`, `policy_extraction_edits` and `member_data_exclusions`.

**`benefit_catalogue` is the single canonical schema** for extraction targets,
SKU coverage, RFQ terms and the customer comparison table (§4.1). Reference
`benefit_key` — do not build a second field list for any of these. The importer
asserts this alignment on every run.

**No real PII or PHI in this environment, ever, at any milestone.** Every seed,
fixture and test uses synthetic data. Production data handling is gated on the
§16 compliance review, which has not happened.

## Open decisions

`ARCHITECTURE.md` §18 lists decisions that need a human. Those closed during M0
are recorded in `docs/decisions/`. Two remain open _within_ M0's own surface:

- **Manager write scope** — see `docs/decisions/0004-manager-write-scope.md`.
  Currently implemented conservatively (own deals only).
- **`min_lives_for_premium` is per-family for one insurer**, but §4.3's premium
  formula treats it as a scalar. Blocks nothing until M3. See
  `docs/decisions/0003-guardrails-import.md`.
