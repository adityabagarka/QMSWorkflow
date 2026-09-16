# Rollover Quote Management System

Internal system for Plum's rollover quote workflow. `ARCHITECTURE.md` is the
source of truth for the data model, module specs, roles and security
requirements; `CLAUDE.md` carries scope and conventions.

## Status: M0 — Foundation

Current milestone scope (ARCHITECTURE.md §17):

| Piece | State |
|---|---|
| Repo scaffolding (Next.js + TypeScript) | done |
| Core DB schema (§4.2) | done — 40 tables |
| RLS for the role/span model (§15) | done — 47 assertions passing |
| Append-only `audit_log` (§16) | done |
| Guardrails workbook import (§4.3) | done — 12 tables, idempotent |
| Google Workspace SSO (OIDC) | not started |
| `access_requests` onboarding flow (§15) | schema done, UI not started |

Nothing beyond M0 has been started. M1 (Salesforce sync) is blocked on the
field-level mapping in §18.4 regardless.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in DATABASE_URL at minimum

npm run db:migrate             # apply supabase/migrations in order
npm run db:test                # prove the §15 role/span model (pgTAP)
npm run db:import-guardrails   # load the reference workbook
```

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

**`audit_log` is append-only.** Enforced by revoked grants *and* a trigger, so
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
are recorded in `docs/decisions/`. Two remain open *within* M0's own surface:

- **Manager write scope** — see `docs/decisions/0004-manager-write-scope.md`.
  Currently implemented conservatively (own deals only).
- **`min_lives_for_premium` is per-family for one insurer**, but §4.3's premium
  formula treats it as a scalar. Blocks nothing until M3. See
  `docs/decisions/0003-guardrails-import.md`.
