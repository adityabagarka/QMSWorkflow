# Rollover Quote Management System — project instructions

Read `ARCHITECTURE.md` before writing any code. It is the source of truth for data model, module specs, roles/permissions, and security requirements. This file is scope and conventions only — it does not restate the architecture.

## Current milestone

**M0 — Foundation** (see `ARCHITECTURE.md` §17). Scope for this milestone only:
- Repo scaffolding (Next.js + TypeScript)
- Google Workspace SSO (OIDC)
- Core DB schema from §4.2, deployed to Supabase (`ap-south-1`)
- Postgres RLS policies for the role/span model in §15
- Import `fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx` sheets as seed data per the mapping table in §4.3
- `access_requests` onboarding flow (§15) — new user → pending → Admin/Super Admin approves with role + manager assignment

Do not start on M1 (Salesforce sync) or later milestones until M0 is reviewed and confirmed working. Build and confirm one milestone at a time — this spec was deliberately sequenced so scope stays bounded per session.

## Environment

Build against the staging stack in `ARCHITECTURE.md` §3.1: Vercel (function region `bom1`), Supabase Postgres (`ap-south-1`), S3-compatible object storage, GitHub for source and preview deploys.

**Hard rule: no real PII/PHI in this environment, ever, at any milestone.** Use synthetic data for every seed script, fixture, and test. If a task seems to require real customer data to proceed, stop and flag it rather than requesting or fabricating a workaround — production data handling is gated on the compliance review in §16, which hasn't happened yet.

## Canonical schema discipline

`benefit_catalogue` (imported from the guardrails workbook, §4.1) is the single schema for policy extraction targets, SKU coverage, RFQ terms, and the customer comparison table. Do not create a second field list for any of these — reference `benefit_key` everywhere.

## Things to flag, not decide

These are called out as open in `ARCHITECTURE.md` §18 and need a human, not a default:
- Cloud provider for production (AWS assumed, not finalized)
- LLM provider and data-processing agreement for PHI/PII (blocks M2 policy extraction)
- Workflow orchestrator choice (Temporal recommended, not confirmed)
- Salesforce field-level mapping (blocks M1)
- Data retention policy specifics
- Outlier threshold (15% suggested default)

If a milestone's implementation would require picking one of these, stop and ask rather than picking a default silently.

## Conventions

- TypeScript throughout; Next.js for the app.
- Every state transition on a `cases` row (or any child entity) writes to `audit_log` — append-only, no UPDATE/DELETE grants (§16).
- Enforce role/span access via Postgres RLS, not just application-layer checks (§15).
- UI follows the Plum Design System (`plum-design.md`, referenced in §14) — cream surface, GT Alpina serif for headlines/stat figures, Passenger Sans for UI, plum-red (`#FF4052`) for emphasis only. Internal app = dense/editorial-adapted; customer-facing quote page = full editorial/marketing register.
- Every member-data exclusion, insurer decline reason, and deemed-acceptance event logs its evidence, not just a status flag (§9, §11) — these need to be explainable/disputable later.
