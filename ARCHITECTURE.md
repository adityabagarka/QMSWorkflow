# Rollover Quote Management System — Build Specification

**For:** Claude Code (ground-up build)
**Author context:** Plum (B2B insurtech broker, India) — Insurance Partnerships
**Phase 1 scope:** Rollover deals only (market deals via Salesforce, not renewals)
**Prepared:** Sep 2026

---

## 0. How to use this document

This is a build spec, not a tutorial. Sections 1–7 are the architecture and data model — read these first and get them reviewed before writing code, since everything downstream depends on them. Sections 8–14 are module-by-module functional specs. Section 15 is roles/permissions. Section 16 is security/compliance — non-negotiable given the data this system holds. Section 17 is the phased build plan. Section 18 is the list of open decisions that need a human (not Claude Code) to close out before or during the build.

Two source files accompany this spec and should be imported as-is, not re-derived:
- `fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx` — the pre-approved plan engine's complete rule set (pricing, coverage, guardrails, appetite, member data validation rules). Treat every sheet in it as seed data for a corresponding DB table (mapping given in §5).
- `plum-design (1).md` — the design system for the web app UI (§14).

---

## 1. What phase 1 actually builds

**In scope:**
- Salesforce-sourced rollover case intake, bi-directional sync
- LLM-based policy copy extraction into structured terms
- Pre-approved ("Plum exclusive") plan matching against the guardrails engine
- RFQ pack generation and dispatch to insurers by email
- Insurer response tracking: reminders, declines, incomplete-quote clarification, deemed acceptance
- Quote compilation, outlier flagging, negotiation loop
- Customer-facing comparison page and decision capture
- Post-decision issuance tracking and audit archive
- Role-based web app (six roles) + Slack as the notification/action surface
- Enterprise security baseline (SOC 2, ISO 27001, GDPR, DPDP Act, IRDAI)

**Explicitly out of scope for phase 1** (build the architecture so these slot in without rework):
- Item 6 of the RFQ pack — auto-generated, insurer-customised analysis of claims/member data. Parked for phase 2. Leave an extension point in the RFQ pack assembly module (§10) but do not build the reasoning logic now.
- Insurer portal/API integrations — no insurer currently offers one; email is the only channel. Design the dispatch/ingestion layer so a future API integration is a new adapter, not a rewrite.
- Renewal deals (Plum's own book) — this system is rollover-only in phase 1.

---

## 2. High-level architecture

```
                                   ┌─────────────────────┐
                                   │   Google Workspace   │
                                   │   SSO (OIDC/SAML)    │
                                   └──────────┬───────────┘
                                              │
   ┌────────────┐     bi-directional   ┌─────▼──────────────────────┐     ┌───────────────┐
   │  Salesforce │◄────────sync───────►│        API / App layer      │◄───►│   Web App UI   │
   │  (case data)│                     │   (auth, RBAC, business     │     │ (internal +    │
   └────────────┘                     │    logic, REST/GraphQL)     │     │  customer-     │
                                       └─────────────┬────────────────┘     │  facing pages) │
   ┌────────────┐                                    │                     └───────────────┘
   │   Gmail /   │◄─── RFQ dispatch, reminders ──────►│
   │  Workspace  │                                    │
   │    Email    │                                    │
   └────────────┘                     ┌───────────────▼────────────────┐
                                       │   Workflow orchestrator        │
                                       │   (durable execution engine —  │
   ┌────────────┐   approvals,        │   drives Phases 0–6, owns all  │     ┌───────────────┐
   │    Slack    │◄──notifications───►│   wait-states & reminders)     │     │  LLM provider  │
   │  (Bolt app) │                    └───────────────┬─────────────────┘◄───┤  (extraction,  │
   └────────────┘                                     │                     │  parsing)      │
                                       ┌───────────────▼────────────────┐    └───────────────┘
                                       │      PostgreSQL (primary DB,   │
                                       │      source of truth) + RLS    │
                                       └───────────────┬────────────────┘
                                                        │
                                       ┌───────────────▼────────────────┐
                                       │  Object storage (policy PDFs,  │
                                       │  RFQ packs, census files,      │
                                       │  encrypted at rest)            │
                                       └─────────────────────────────────┘
```

**Core principle: the Postgres DB is the single source of truth.** Salesforce and Slack are synced views/action surfaces, never the record of state. Every state transition, timestamp, and document reference is written to the DB first; SF field updates and Slack messages are downstream effects of that write, not the primary event. If SF or Slack integration fails, the case still progresses correctly in the DB and the integration retries/alerts.

**Why a durable workflow orchestrator, not a simple job queue:** Phase 3's reminder cascade spans up to 15 days with expiry-aware branching, and the whole case can run for weeks with multiple human-approval pauses. A durable execution engine (Temporal is the reference recommendation — self-hostable, handles long-running state machines with retries and human-in-the-loop waits natively) is a much better fit than cron jobs + a database status column, which tends to become unmaintainable once you have this many branch conditions. This is a build-time recommendation, not a hard requirement — flag if your engineering team has a preferred alternative (e.g. AWS Step Functions if landing on AWS, per §18).

---

## 3. Tech stack

| Layer | Recommendation | Notes |
|---|---|---|
| Cloud provider | **Open — see §18.** Spec below is written cloud-agnostically with AWS-flavoured naming as the working assumption; swap per the equivalents table if GCP/Azure is chosen. |
| Compute | Containerized services (ECS/Fargate on AWS, GKE on GCP) | Stateless API layer, horizontally scalable |
| Primary DB | PostgreSQL 15+, managed (RDS / Cloud SQL) | Row-level security (RLS) for role/span-based access — see §15 |
| Workflow orchestration | Temporal (self-hosted or Temporal Cloud, India region if available; else self-host in-region) | Drives Phases 0–6 |
| Object storage | S3 / GCS, India region, encrypted (SSE-KMS) | Policy PDFs, RFQ packs, census files, generated docs |
| Cache / queue | Redis (ElastiCache / Memorystore) | Session cache, rate limiting, lightweight pub/sub |
| Auth | Google Workspace SSO via OIDC | MFA enforced at IdP level |
| LLM provider | **Open — see §18.** Must run under a data processing agreement covering PII/PHI, or use an in-VPC/private deployment. Do not send member-level PHI to a consumer LLM API without a DPA in place. |
| Email | Gmail API (Workspace) | RFQ dispatch, reminders, clarification emails, inbound response parsing via a dedicated shared mailbox |
| Slack | Slack Bolt (Node or Python) | Approval cards, reminder-lag alerts, case notifications |
| Frontend | React + TypeScript | Design system per §14 |
| Doc generation | RFQ pack: templated PDF/XLSX generation (e.g. a headless-Sheets or docx/xlsx templating library) from the canonical benefit schema (§6) | Must reproduce the existing Google Sheets RFQ template layout |
| Observability | Structured logging + APM (Datadog/CloudWatch/Cloud Logging) + immutable audit log (§16) | Audit log is a separate, append-only store from operational logs |

### 3.1 Staging / validation environment (build here first)

Before production hosting is finalized (§18), build and validate against this environment — chosen so every piece migrates cleanly rather than getting thrown away:

| Layer | Staging choice | Why it migrates cleanly |
|---|---|---|
| Source control / CI | GitHub, Vercel's GitHub integration for preview deploys per PR | Unchanged regardless of production target |
| Compute | Next.js on Vercel, function region pinned to `bom1` (Mumbai) | Standard Node app — lifts into ECS/Fargate or Cloud Run with a Dockerfile |
| Database | Supabase Postgres, `ap-south-1` (Mumbai) | Real Postgres with native RLS — validates the §15 role/span model now; migrates via `pg_dump`/`pg_restore` into RDS or Cloud SQL |
| Object storage | S3-compatible bucket (Cloudflare R2, or a small real S3 bucket) | Swap endpoint/credentials only if moving to production S3/GCS — avoid Vercel-proprietary blob storage |
| Orchestration | DB-status-driven state machine + scheduled functions (`pg_cron` / Vercel Cron) standing in for durable timers | The one piece that isn't a like-for-like swap — build the Phase 0–6 logic behind a clean interface so replacing the cron-driven clock with Temporal at production time doesn't touch the reminder-cascade logic itself |
| Auth, Slack, Gmail | Unchanged | These integrate the same way regardless of host |

**Hard boundary: no real PII/PHI in this environment.** Use synthetic or masked data for every validation pass until production hosting meets the full §16 compliance posture (India residency confirmed at the infrastructure level, not just function-region selection; SOC 2/ISO 27001/DPDP/IRDAI posture signed off). A Mumbai function region is not the same thing as a certified compliance posture — don't let the two get conflated when deciding what data is safe to use here.

**Migration checklist, staging → production:** DB dump/restore into RDS or Cloud SQL; object storage synced to the production bucket; orchestration swapped from cron-driven to Temporal-driven behind the existing interface; secrets moved into the production KMS; RLS policies re-verified post-migration; full §16 compliance review completed — before any real customer/member data is loaded.

**AWS ↔ GCP equivalents** (for when §18 resolves):

| Need | AWS | GCP |
|---|---|---|
| Compute | ECS Fargate | GKE Autopilot / Cloud Run |
| DB | RDS Postgres | Cloud SQL Postgres |
| Object storage | S3 | GCS |
| Cache | ElastiCache Redis | Memorystore |
| Secrets | Secrets Manager | Secret Manager |
| KMS | KMS | Cloud KMS |
| Queue | SQS | Pub/Sub |

---

## 4. Canonical data model

### 4.1 Design decision: one benefit schema, three uses

The RFQ template you provided and the SKU coverage sheet in the guardrails workbook describe the *same ~60 fields* (members covered, LGBTQ cover, room rent limits, maternity cover, etc.). The guardrails workbook already has this formalised as `benefit_catalogue` (display_order, section, benefit_label, benefit_key). **Use this one table as the canonical schema for three things at once:**
1. The target schema for LLM policy-copy extraction (§9) — every extracted field maps to a `benefit_key`.
2. The columns of every insurer's SKU coverage row (`sku_coverage`, already in this shape).
3. The columns of the customer-facing comparison table (§13) and the RFQ template's Expiring/Proposed Terms columns.

Do not build three separate schemas for these. One `benefit_catalogue` + one `policy_terms` value table (keyed by `benefit_key`) referenced from `policies`, `rfqs`, `insurer_quotes`, and `sku_coverage` covers all of it.

### 4.2 Core entities

| Table | Purpose | Key fields |
|---|---|---|
| `users` | All system users | id, email, name, role, manager_id, status (pending/active/suspended) |
| `access_requests` | Onboarding approval queue | id, requested_by, requested_role, assigned_manager_id, status, approved_by |
| `salesforce_accounts` | SF org connection config | org_id, credentials (via secrets manager, not stored in DB) |
| `cases` | One row per rollover case | id, sf_record_id, sf_record_type, deal_type, owner_user_id, current_phase, state, policy_expiry_date, created_at |
| `case_events` | Append-only case timeline | case_id, event_type, actor (user or "system"), payload, created_at |
| `policies` | Expiring policy master record | id, case_id, insurer_name (incumbent), policy_start, policy_end, sum_insured, industry, entity_type |
| `policy_documents` | Uploaded policy copy files | id, policy_id, file_ref (object storage), doc_type, uploaded_by |
| `policy_extractions` | LLM extraction run + result | id, policy_document_id, model_version, extracted_terms (jsonb, keyed by benefit_key), confidence_scores, status |
| `policy_extraction_edits` | Every RM correction to an extraction | id, extraction_id, benefit_key, original_value, corrected_value, corrected_by, corrected_at — **this is the fine-tuning feedback loop; never overwrite, always append** |
| `policy_terms` | Finalised terms after RM review | policy_id, benefit_key, value, source (extracted/manual/plan-match) |
| `plan_matches` | Pre-approved ("Plum exclusive") SKU matches for a case | id, case_id, insurer_sku_id, is_eligible, guardrail_evaluation (jsonb, full trace of which rules passed/failed), matched_at |
| `member_uploads` | Raw census file as received | id, case_id, file_ref, detected_format, uploaded_at |
| `member_records` | Cleaned, validated member roster | id, case_id, relationship, gender, dob, age, employee_id, name_clean, exclusion_flags (jsonb per insurer) |
| `member_data_exclusions` | Log of every exclusion, per rule F-04 | id, member_record_id, insurer, rule_id, reason |
| `claims_uploads` | Incumbent claims data as received | id, case_id, file_ref, detected_format |
| `burn_calculations` | Indicative pricing runs | id, case_id, incurred_claims, cashless_ratio, ibnr_pct, annualised_claims, per_life_claims_cost, inflation_pct, tpa_fee_pct, brokerage_pct, insurer_opex_pct, indicative_premium, computed_at, computed_by |
| `rfqs` | One RFQ per case | id, case_id, covers_added, covers_removed, deadline, compliance_reviewed_by, dispatched_at |
| `insurer_rfqs` | One row per insurer per RFQ | id, rfq_id, insurer_name, status (sent/responded/declined/not_responded/deemed_accepted), dispatched_at, decline_reason |
| `quote_versions` | Every insurer quote version | id, insurer_rfq_id, version_no, terms (jsonb by benefit_key), premium, received_at, is_outlier, outlier_reason |
| `reminders_log` | Every reminder sent | id, insurer_rfq_id, reminder_type (T+4/7/10/15/T-1/internal-slack), sent_at |
| `clarifications` | Incomplete-quote clarification threads | id, insurer_rfq_id, sent_at, deadline_24h, response_received, deemed_accepted_at, evidence_ref |
| `compliance_reviews` | RFQ QC sign-off | id, rfq_id, reviewed_by, status, notes, reviewed_at |
| `negotiation_rounds` | Phase 4.4 negotiation loop | id, case_id, round_no, insurers_included, initiated_by, resolved_at |
| `customer_quote_links` | Public comparison page tokens | id, case_id, token (signed, expiring), preferred_insurer_id, created_at, expires_at |
| `customer_link_views` | Engagement tracking | id, customer_quote_link_id, viewed_at, section_viewed |
| `customer_decisions` | Final customer decision + consent | id, case_id, selected_insurer_id, decided_at, consent_evidence_ref |
| `issuance` | Post-decision tracking | id, case_id, insurer_id, issuance_requested_at, certificate_ref, brokerage_reconciled |
| `audit_log` | Immutable, append-only, all state changes | id, entity_type, entity_id, action, actor, before, after, timestamp — **never updated or deleted; see §16** |

### 4.3 Guardrails engine reference tables (imported from the xlsx)

Import each sheet of `fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx` as a DB table with the same name and columns. These are **admin-editable reference data**, not application code — the Admin role's "configure pre-approved plans" permission (§15) is CRUD access to these tables via the app, not a code change.

| Sheet → Table | Rows (at upload) | Role in the system |
|---|---|---|
| `sku_pricing` | 1,441 | Rate build-up per SKU per insurer; drives plan-match pricing |
| `sku_coverage` | 1,441 | Coverage terms per SKU, keyed by `benefit_key` per §4.1 |
| `benefit_catalogue` | 59 | Canonical schema — see §4.1 |
| `insurer_guardrails` | 10 | Per-insurer size/age/ratio/commercial limits |
| `insurer_family_guardrails` | 28 | Per-insurer, per-family-definition eligibility |
| `insurer_member_age_windows` | 37 | Age windows per insurer per member type |
| `member_data_rules` | 38 | The full A–F rule set — this **is** the member data validation/cleanup engine spec (§11); implement each rule_id literally |
| `appetite_industry` | 415 | Industry-level insurer appetite (hard block if declined) |
| `appetite_entity` | 82 | Legal-entity-type appetite |
| `rate_base` | 136 | Base rate per insurer/family/SI |
| `rate_factors` | 97 | Loading factors per dimension/option |
| `enums` | 32 | Allowed values for every coded field — use as DB check constraints or a lookup-validated enum type |

The `_schema` sheet in the workbook documents the rate formula by `loading_method` (`additive_on_base`, `compounding`, `magma_absolute`) and the premium formula (`MAX(per_life_rate * MAX(rated_lives, min_lives_for_premium), min_premium)`) — implement these exactly as given, they are not to be re-derived.

---

## 5. Salesforce integration

**Sync mechanism:** Salesforce Change Data Capture (CDC) or Platform Events for near-real-time inbound sync; outbound writes via standard REST API calls from the orchestrator on state transitions. Avoid polling if CDC is available on the org's SF edition — confirm licensing with your SF admin.

**Inbound (SF → system):**
- Every record whose record type identifies it as a rollover deal, scoped to the requesting user's own records by default (their sync should show *all* their deals, flagged by record type, not just rollover ones — confirmed) — pull deal owner, customer name, policy expiry, industry, entity type, and any other fields already captured on the record type layout. **Assumption, confirm with SF admin:** exact field API names for policy expiry, industry, and entity type, since these drive the guardrails appetite lookup (§4.3) and must map cleanly.
- Record type value itself, stored on `cases.sf_record_type`, used only as a display flag per the stated intent — not as a filter condition, since the user already scoped that instruction to "pull" logic being irrelevant to record type.

**Outbound (system → SF):**
- Case status/phase updates (written back so SF reflects where the deal is in the pipeline)
- Key milestone timestamps (RFQ dispatched, quotes received, preferred insurer selected, customer decision, policy issued)
- **Assumption, confirm with SF admin:** which SF fields receive these writes — likely either standard Opportunity stage progression or a custom field set on the rollover record type. Do not guess field-level mapping further than this; get the field list from whoever owns the SF org before building the write-back adapter.

**Conflict resolution:** the DB is authoritative for workflow state (phase, quote status, decisions). SF is authoritative for deal/customer master data (company name, contact details) unless the RM edits it in-system, in which case the system writes back on save.

---

## 6. Pre-approved ("Plum exclusive") plan matching engine

Runs automatically as part of Phase 1 (policy review), before the RFQ is prepared:

1. Take the case's industry, entity type, and (once known) census/member data.
2. Evaluate against `appetite_industry` and `appetite_entity` — any insurer marked `is_acceptable = 0` is excluded from plan matching entirely (E-08, E-09).
3. For each remaining insurer, evaluate `insurer_guardrails`, `insurer_family_guardrails`, and the full member-data rule set A–F (§11) against the case's member data once available.
4. For every SKU that passes every applicable rule, mark it `is_eligible = true` in `plan_matches`, and store the full guardrail evaluation trace (which rules passed, which excluded which members) — this trace is what lets the RM explain the quote to the customer later, don't discard it.
5. Surface eligible plans to the RM **before** RFQ prep, tagged **"Plum exclusive."**
6. Per the explicit product decision: even when a Plum-exclusive match exists for an insurer, still send that insurer a full RFQ. The comparison at Phase 4/5 includes the Plum-exclusive plan as one of the options from the start — it is not a replacement for going to market with that insurer, it's an additional, faster option shown alongside.

---

## 7. RFQ pack

Six components (item 6 deferred to phase 2 per §1):

1. **RFQ document** — generated from the canonical benefit schema (§4.1), matching the layout of the existing Google Sheets template (insured details, expiring policy details, then the Expiring Terms / Proposed Terms comparison table across all `benefit_catalogue` rows).
2. **Current policy copy** — the uploaded PDF, attached as-is.
3. **Current claims data and analysis report** — as provided by the incumbent, attached after passing the ingestion/validation layer (§10).
4. **Member data** — cleaned via the de-dupe/validation engine (§11), attached in a standard format regardless of the incumbent's original format.
5. **Indicative pricing calculation** — the burn calculation output (§12), shown per insurer where member eligibility differs.
6. **~~Auto-generated per-insurer analysis~~** — phase 2. Leave a named but unimplemented extension point in the pack-assembly function (e.g. a no-op module the pipeline calls and currently returns nothing) so it's a plug-in later, not a rewrite.

**Compliance review gate (2.4):** the assembled pack, before dispatch, goes to the compliance review human gate. Do not allow dispatch to skip this step even for Plum-exclusive-only cases.

---

## 8. Policy copy extraction (LLM)

- Input: uploaded policy PDF (may be scanned/image-based — include OCR in the pipeline, don't assume clean text PDFs).
- Extraction target: every `benefit_key` in `benefit_catalogue`, plus header fields (insured name, industry, location, incumbent insurer, broker, policy start/end, claims-data-as-on date).
- Output stored in `policy_extractions.extracted_terms` (jsonb) with a per-field confidence score.
- RM reviews and corrects in the web app; **every correction is written to `policy_extraction_edits`, never discarded.** This table is the fine-tuning signal referenced in your answer to question 2 — design the schema so it can be exported as a training/eval set (extraction vs. corrected value, per field, over time) without additional migration later.
- Only the corrected, RM-approved values move to `policy_terms` and become the RFQ's "Expiring Terms" column.

---

## 9. Claims & member data ingestion

**Format detection layer** — every customer/incumbent may use their own template:
1. Parse the uploaded file's structure (column headers, sheet names) and attempt to auto-map to the standard schema using header-similarity matching (fuzzy match against known synonyms, e.g. "DOB"/"Date of Birth"/"D.O.B" all map to `dob`).
2. Where auto-mapping confidence is low, surface a column-mapping UI for the RM to confirm manually before proceeding — do not silently guess on ambiguous columns.
3. Once mapped to the standard schema, run the **member data rule engine** — implement every rule in `member_data_rules` literally, in the stage order given (1. Ingest → 2. Normalise → 3. Derive → 4. Member eligibility per insurer → 5. Group validation → 6. Output). Key behaviours to get exactly right, since they're easy to get subtly wrong:
   - Age is computed with a 365-day divisor, not calendar-anniversary logic (rule C-01) — deliberate, matches the existing rater, do not "fix" this.
   - Member eligibility exclusions (stage 4) are **per insurer** — the same member roster produces a different `rated_lives` count for each insurer. Every downstream premium calculation and comparison screen must show the member count alongside that insurer's premium, never a single shared count (rule D-10).
   - Parent:employee ratio (E-01) is computed **after** the D-rules exclusions, not before.
   - Every exclusion, at any stage, is logged to `member_data_exclusions` with the specific rule_id and reason (rule F-04) — this is what lets an RM explain to a customer why one insurer's quote covers fewer lives than another's.
4. Claims data ingestion follows the same format-detection pattern, feeding the burn calculation module (§10).

---

## 10. Burn calculation (indicative pricing)

Implement exactly as specified, in this order:

1. **Incurred claims** = current paid claims + outstanding claims, as provided by the incumbent.
2. **Annualise** incurred claims over the policy's run days relative to full policy tenure (i.e. scale up a partial-year claims figure to a full-year equivalent).
3. **Add IBNR** (incurred but not reported), banded by cashless-claims share of total claims value:
   - Cashless > 70% of claims value → **IBNR = 3%**
   - Cashless < 50% of claims value → **IBNR = 5%**
   - Cashless between 50% and 70% inclusive → **IBNR = 4%**
4. **Adjust to weighted-average lives** in the policy to arrive at a per-life claims cost.
5. **Add inflation** at 5% to get next year's per-life claims cost.
6. **Multiply by the number of lives to be quoted** (per insurer, from the member eligibility engine in §9 — this is why burn calculations are computed per insurer, not once per case).
7. **Add, in order:** TPA fees (default 2.5%), brokerage (default 7.5%), insurer OPEX (default 5%) → total indicative premium.

TPA fee %, brokerage %, and insurer OPEX % are deal-level configurable (RM can edit before finalizing the RFQ); the values above are defaults only, stored per-case in `burn_calculations` so historical calculations remain reproducible even if defaults change later.

Store every burn calculation run (not just the latest) — `burn_calculations` is append-only per case, since the RM may re-run it as census or claims data changes during Phase 1.

---

## 11. Insurer response tracking (Phase 3)

Full detail is in the earlier workflow discussion; the build-relevant points:

- `insurer_rfqs.status` state machine: `sent → responded | declined | not_responded | deemed_accepted`, with `quote_versions` tracking every revision under `responded`.
- Reminder cascade (T+4/7/10/15 from `rfqs.dispatched_at`, or T-1-day-only if `cases.policy_expiry_date` falls inside that window) is owned by the workflow orchestrator as durable timers, not application-level cron — this is precisely the kind of multi-day, branch-on-external-event logic Temporal (or equivalent) is built for.
- Every external reminder also fires an internal Slack alert to the case owner — implement as a side effect of the same timer firing, not a separate schedule.
- Incomplete-quote clarification: 24-hour silent-consent window, and on expiry, write to `clarifications.deemed_accepted_at` along with `evidence_ref` pointing to the clarification email and the elapsed-time record — this needs to be retrievable as evidence, not just a boolean flag, since it may be disputed later.

---

## 12. Quote compilation & negotiation (Phase 4)

- Compile progressively as `quote_versions` rows arrive — don't gate the summary view on every insurer having responded.
- Outlier flagging: compare each insurer's premium against the indicative burn-calc premium (§10) and flag material deviations (configurable threshold, default suggestion: >15%) plus any missing mandatory cover, before the RM opens the summary.
- Preferred-insurer selection and negotiation-round initiation are both human gates (§1, RM action in the web app or via a Slack approval card) — the orchestrator pauses and waits.
- A negotiation round (`negotiation_rounds`) re-enters a lightweight variant of the Phase 3 dispatch/tracking flow scoped to the selected insurers only, not a full case restart.

---

## 13. Customer-facing quote (Phase 5)

- `customer_quote_links` generates a signed, expiring token — the public page is unauthenticated but only accessible via that token, never indexable or guessable.
- Comparison table renders from the same `benefit_catalogue`/`policy_terms` schema as everything else (§4.1) — coverage comparison, what each insurer is missing, insurer USPs.
- `customer_link_views` logs view events and which section was viewed, for RM follow-up context — do not log more than view/section-level granularity; this is engagement tracking, not surveillance.
- `customer_decisions` captures the final selection plus consent evidence (e.g. a timestamped click-to-accept with the exact terms shown at that moment stored alongside it, in case terms are later disputed).

---

## 14. Web app UI

Build against the **Plum Design System** (`plum-design (1).md`, attached) — cream surface, GT Alpina serif for headlines/stat figures, Passenger Sans for UI, single plum-red (`#FF4052`) for emphasis, hairline rules, no gradients/glassmorphism. Two distinct UI contexts:

- **Internal app (dashboards, case tracking, RFQ builder, admin console):** the design system's editorial voice adapts to a denser, utility-first layout than its marketing origin — tables, status chips (use the four-step severity scale `--sev-blush → --plum-red` for status/urgency, e.g. reminder lag or outlier severity), and the Lucide icon substitution named in the source doc, since a working app needs more iconography than the icon-light marketing system provides. Keep the cream field, hairline dividers, and plum-red-only-for-emphasis discipline even in dense views — don't let a dashboard turn into a generic SaaS grey UI.
- **Customer-facing quote page:** lean fully into the editorial/marketing register the design system is built for — hero-style presentation, serif stat numerals for premium figures, arrow-tipped rules, a confident single CTA ("accept this quote"). This page is customer-facing brand expression, not an internal tool.

**Core screens:**
1. Deals dashboard (role-scoped per §15)
2. Case detail / phase tracker (mirrors Phases 0–6)
3. Policy extraction review (side-by-side PDF + extracted fields, inline correction)
4. Member data upload & cleanup review (mapping confirmation, exclusions log)
5. RFQ builder/preview (cover sign-off, plan-match display, compliance review queue)
6. Insurer tracking board (kanban-style, one column per `insurer_rfqs.status`)
7. Quote comparison & outlier review (Phase 4)
8. Customer-facing quote page (Phase 5, public token-gated)
9. Admin console — CRUD on the guardrails reference tables (§4.3), user/manager mapping and access-request approval
10. Super Admin console — full system config, integration health, audit log access

---

## 15. Roles & permissions

| Role | Deal visibility | Can transact (own deals) | Configure system |
|---|---|---|---|
| Consultant | Own deals only | Yes | No |
| Manager | Own deals + team span | Yes (both capabilities, no per-user toggle) | No |
| Leader | Entire span (read-only) | No | No |
| Head of Department | Entire span (read-only) | No | No |
| Admin | All deals (read-only) | No | Pre-approved plans / guardrails reference data (§4.3) only — not core system config |
| Super Admin | Everything | Yes (system-level) | Full — including core functionality, user provisioning |

**Org mapping is not from Salesforce** — it's a separate reporting structure maintained inside this system. New users authenticate via Google Workspace SSO, land in `access_requests` as pending, and an Admin (or Super Admin) approves the request and assigns both role and manager at that point (`users.manager_id`). "Span" for Manager/Leader/HoD visibility is computed by walking this manager hierarchy, not any Salesforce role field.

**Enforce at the DB layer, not just the app layer** — implement Postgres row-level security (RLS) policies on `cases` and every child table keyed off `owner_user_id` and the manager-hierarchy walk, so a bug in application-layer permission checks can't leak cross-user deal data. This matters more than usual given the PII/PHI/commercial-terms sensitivity (§16).

---

## 16. Security & compliance

This system holds PII, PHI (claims/medical data), and commercially sensitive data (insurer pricing terms, brokerage %, revenue numbers). Target standards: **SOC 2 Type II, ISO 27001, GDPR, India's DPDP Act 2023, and IRDAI outsourcing/data-handling norms.** Hosting: **India only** (region TBD per §18, but must be an India data-center region regardless of provider).

**Non-negotiables to build in from day one, not retrofit:**

- **Auth:** Google Workspace SSO (OIDC/SAML), MFA enforced at the IdP.
- **RBAC + RLS:** as specified in §15 — enforced at the database layer.
- **Encryption:** TLS 1.2+ in transit everywhere, AES-256 at rest for the DB and object storage; consider field-level encryption for the most sensitive columns (member DOB, claims amounts, commission %) so a storage-layer breach doesn't expose them in plaintext even with disk access.
- **Immutable audit log:** `audit_log` is append-only — no UPDATE or DELETE grants on this table for any application role, including Super Admin's application account (break-glass access, if ever needed, should be a separate, logged, out-of-band process). Every state change across the system writes here: who, what, before/after, when.
- **LLM data handling (§3, §18):** policy copies and member data contain PHI/PII. Do not send this data to any LLM API without a data processing agreement in place covering it, or use an in-VPC/private model deployment. This is a blocking decision for §9's extraction pipeline, not a nice-to-have.
- **Slack data minimisation:** Slack messages and approval cards should carry case status, summary figures, and action buttons — never raw census rows, claims line items, or full policy terms. Link back to the web app (authenticated) for anyone who needs the underlying detail.
- **Customer-facing link security (§13):** signed, expiring tokens; rate-limited; no PII in the URL; WAF in front of the public endpoint given it's the one unauthenticated surface in the system.
- **Secrets management:** all credentials (SF, Gmail, LLM provider, DB) in a secrets manager / KMS, never in code or environment files committed anywhere.
- **Backup & DR:** automated encrypted backups, tested restore process, documented RPO/RTO — required for both SOC 2 and ISO 27001 evidence.
- **Data retention:** align retention period with IRDAI broker record-keeping norms (multi-year) while building in a defensible process for DPDP-driven erasure requests where they don't conflict with regulatory retention — this needs a policy decision (§18), not just a technical toggle.
- **Vendor risk:** any third-party (LLM provider, cloud provider, email API) processing PII/PHI needs its own due-diligence record as part of the SOC 2/ISO 27001 evidence trail — flag this as a parallel workstream for whoever owns compliance, not something Claude Code can resolve in code.

---

## 17. Build phasing

| Milestone | Scope |
|---|---|
| M0 — Foundation | Infra scaffolding, Google Workspace SSO, RBAC + RLS, core DB schema, import guardrails workbook as seed data |
| M1 — Salesforce sync | Inbound case intake, outbound status write-back (pending field-mapping confirmation, §5) |
| M2 — Policy extraction | Upload → OCR → LLM extraction → RM review/correction UI → `policy_extraction_edits` logging |
| M3 — Plan matching + RFQ | Guardrails engine (§6), member data ingestion (§9), burn calculation (§10), RFQ pack assembly (§7, item 6 stubbed) |
| M4 — Dispatch & tracking | Orchestrator-driven Phase 3: dispatch, reminder cascade, decline/incomplete/deemed-acceptance handling |
| M5 — Compilation & comparison | Phase 4 summary, outlier flagging, negotiation loop |
| M6 — Customer quote & decision | Phase 5 public page, engagement tracking, decision capture |
| M7 — Issuance & close | Phase 6, audit archive, case close-out |
| M8 — Security hardening & compliance evidence | Penetration testing, SOC 2/ISO 27001 evidence collection, DR test |

Phase 2 (not in this build): item 6 auto-generated insurer analysis, insurer API integrations if any become available, deeper negotiation-round automation.

---

## 18. Open decisions — need a human before or during build

1. **Cloud provider** — leaning AWS per your note, not finalized. Sync with engineering before M0; the spec above is written to translate cleanly to GCP if that changes (§3 equivalents table). In the meantime, build and validate against the GitHub + Vercel + Supabase staging environment in §3.1, with real PII/PHI withheld until production hosting is confirmed.
2. **LLM provider and data handling** — must be resolved before M2 (policy extraction) can touch real PHI/PII. Needs either a DPA with the provider or an in-VPC private deployment.
3. **Workflow orchestrator choice** — Temporal recommended; confirm against engineering's existing tooling before M0, since this is a foundational choice that's expensive to change later.
4. **Salesforce field-level mapping** — exact API field names for inbound case data and outbound status write-back (§5); needs your SF admin.
5. **Data retention policy** — the specific retention period and erasure-request handling process needs a compliance/legal decision, not a Claude Code default.
6. **Outlier threshold** — suggested 15% premium deviation as a starting default for §12; confirm or adjust.
