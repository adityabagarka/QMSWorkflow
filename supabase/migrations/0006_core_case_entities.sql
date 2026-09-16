-- 0006_core_case_entities.sql
-- Core case entities.
-- Reference: ARCHITECTURE.md §4.2.
--
-- Every table that hangs off a case carries `case_id` directly, even where the
-- parent chain already implies it (quote_versions -> insurer_rfqs -> rfqs ->
-- cases). This keeps every §15 RLS policy a single lookup instead of a
-- three-hop join, and the redundancy is FK-enforced against the true parent.
--
-- M0 creates structure only. Workflow behaviour lands in M1-M7.

-- --------------------------------------------------------------------------
-- salesforce_accounts (§4.2, §5)
-- Credentials live in the secrets manager, never in the DB (§16) — hence no
-- credential column here. M1 populates this; M0 creates the shell.
-- --------------------------------------------------------------------------
create table salesforce_accounts (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null unique,
  label            text not null,
  secret_ref       text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column salesforce_accounts.secret_ref is
  'Pointer into the secrets manager. The credential itself is never stored here (§16).';

-- --------------------------------------------------------------------------
-- cases (§4.2)
--
-- current_phase tracks Phases 0-6 (§11). `state` is left as a constrained text
-- column in M0: the spec names the column but does not enumerate its values,
-- so the allowed set is pinned in M3/M4 when the workflow logic exists.
-- deal_type is constrained to 'rollover' because phase 1 is rollover-only (§1);
-- widening it is a one-line migration when renewals arrive.
-- --------------------------------------------------------------------------
create table cases (
  id                 uuid primary key default gen_random_uuid(),
  sf_record_id       text unique,
  sf_record_type     text,
  deal_type          text not null default 'rollover',
  customer_name      text not null,
  owner_user_id      uuid not null references app_users (id) on delete restrict,
  current_phase      smallint not null default 0,
  state              text not null default 'draft',
  industry           text,
  entity_type        text,
  policy_expiry_date date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint cases_deal_type_phase1 check (deal_type in ('rollover')),
  constraint cases_current_phase_range check (current_phase between 0 and 6)
);

comment on column cases.sf_record_type is
  'Display flag only, per §5 — never used as a filter condition.';
comment on column cases.owner_user_id is
  'The axis every §15 RLS policy turns on.';

create index cases_owner_idx on cases (owner_user_id);
create index cases_phase_state_idx on cases (current_phase, state);
create index cases_expiry_idx on cases (policy_expiry_date);

-- --------------------------------------------------------------------------
-- case_events (§4.2): append-only case timeline.
-- Distinct from audit_log: this is the user-facing narrative of a case,
-- audit_log is the compliance record of every state change system-wide.
-- --------------------------------------------------------------------------
create table case_events (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references cases (id) on delete cascade,
  event_type text not null,
  actor_type app.actor_type not null,
  actor_id   uuid references app_users (id) on delete restrict,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint case_events_actor_is_resolvable check (
    (actor_type = 'user'   and actor_id is not null) or
    (actor_type = 'system' and actor_id is null)
  )
);

create index case_events_case_idx on case_events (case_id, created_at desc);

-- --------------------------------------------------------------------------
-- Expiring policy and its documents
-- --------------------------------------------------------------------------
create table policies (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null unique references cases (id) on delete cascade,
  insurer_name  text,
  policy_start  date,
  policy_end    date,
  sum_insured   numeric,
  industry      text,
  entity_type   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint policies_dates_ordered check (policy_end is null or policy_start is null or policy_end >= policy_start)
);

comment on column policies.insurer_name is 'The incumbent insurer.';

create table policy_documents (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases (id) on delete cascade,
  policy_id   uuid not null references policies (id) on delete cascade,
  file_ref    text not null,
  doc_type    text not null,
  uploaded_by uuid not null references app_users (id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

comment on column policy_documents.file_ref is
  'Object storage key. Files are never stored in the database (§3.1).';

create index policy_documents_case_idx on policy_documents (case_id);

-- --------------------------------------------------------------------------
-- LLM extraction (§8). M2 populates these; M0 creates the shape.
-- --------------------------------------------------------------------------
create table policy_extractions (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references cases (id) on delete cascade,
  policy_document_id uuid not null references policy_documents (id) on delete cascade,
  model_version      text,
  extracted_terms    jsonb not null default '{}'::jsonb,
  confidence_scores  jsonb not null default '{}'::jsonb,
  status             app.extraction_status not null default 'pending',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz
);

comment on column policy_extractions.extracted_terms is
  'Keyed by benefit_key (§4.1). Not a second field list — every key must exist in benefit_catalogue.';

create index policy_extractions_case_idx on policy_extractions (case_id);

-- Every RM correction, appended, never overwritten (§4.2, §8): this table is
-- the fine-tuning/eval signal, and must stay exportable as
-- (extraction value, corrected value, per field, over time) with no further
-- migration.
create table policy_extraction_edits (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases (id) on delete cascade,
  extraction_id   uuid not null references policy_extractions (id) on delete cascade,
  benefit_key     text not null references benefit_catalogue (benefit_key) on delete restrict,
  original_value  text,
  corrected_value text,
  corrected_by    uuid not null references app_users (id) on delete restrict,
  corrected_at    timestamptz not null default now()
);

create index policy_extraction_edits_extraction_idx on policy_extraction_edits (extraction_id, corrected_at);
create index policy_extraction_edits_benefit_idx on policy_extraction_edits (benefit_key, corrected_at);

-- Finalised terms after RM review — the RFQ's "Expiring Terms" column (§8).
create table policy_terms (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases (id) on delete cascade,
  policy_id   uuid not null references policies (id) on delete cascade,
  benefit_key text not null references benefit_catalogue (benefit_key) on delete restrict,
  value       text,
  source      app.term_source not null,
  updated_at  timestamptz not null default now(),
  unique (policy_id, benefit_key)
);

create index policy_terms_case_idx on policy_terms (case_id);

-- --------------------------------------------------------------------------
-- plan_matches (§6): pre-approved "Plum exclusive" SKU matches.
-- --------------------------------------------------------------------------
create table plan_matches (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null references cases (id) on delete cascade,
  insurer_sku_id       text not null references sku_pricing (insurer_sku_id) on delete restrict,
  is_eligible          boolean not null,
  guardrail_evaluation jsonb not null,
  matched_at           timestamptz not null default now(),
  unique (case_id, insurer_sku_id)
);

comment on column plan_matches.guardrail_evaluation is
  'Full trace: which rules passed, which failed, which members each rule excluded (§6.4). This is what lets an RM explain the quote to the customer later — never discard it, never reduce it to a boolean. It is also what makes a historical match reproducible after an Admin edits the reference data.';

-- --------------------------------------------------------------------------
-- Member and claims data (§9). Member-level rows are PHI/PII.
-- --------------------------------------------------------------------------
create table member_uploads (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases (id) on delete cascade,
  file_ref        text not null,
  detected_format jsonb,
  uploaded_by     uuid not null references app_users (id) on delete restrict,
  uploaded_at     timestamptz not null default now()
);

create table member_records (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases (id) on delete cascade,
  member_upload_id uuid references member_uploads (id) on delete set null,
  relationship     text,
  gender           text,
  dob              date,
  age              integer,
  employee_id      text,
  name_clean       text,
  exclusion_flags  jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

comment on column member_records.age is
  'Computed with a 365-day divisor per rule C-01, not calendar-anniversary logic. Deliberate — matches the live rater.';
comment on column member_records.dob is
  'PHI. Candidate for field-level encryption (§16); deferred pending the KMS decision in §18.1.';
comment on column member_records.exclusion_flags is
  'Per-insurer. The same roster yields a different rated_lives per insurer (rule D-10).';

create index member_records_case_idx on member_records (case_id);

-- One row per (member, insurer, rule_id, reason) — rule F-04. This is the
-- evidence that lets an RM explain why one insurer's quote covers fewer lives.
create table member_data_exclusions (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases (id) on delete cascade,
  member_record_id  uuid not null references member_records (id) on delete cascade,
  insurer           text not null,
  rule_id           text not null references member_data_rules (rule_id) on delete restrict,
  reason            text not null,
  created_at        timestamptz not null default now()
);

create index member_data_exclusions_case_insurer_idx on member_data_exclusions (case_id, insurer);
create index member_data_exclusions_member_idx on member_data_exclusions (member_record_id);

create table claims_uploads (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references cases (id) on delete cascade,
  file_ref        text not null,
  detected_format jsonb,
  uploaded_by     uuid not null references app_users (id) on delete restrict,
  uploaded_at     timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- burn_calculations (§10): append-only per case; every run is kept so a
-- historical calculation stays reproducible even after defaults change.
-- Percentages are stored per row, not read from config at read time.
-- --------------------------------------------------------------------------
create table burn_calculations (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references cases (id) on delete cascade,
  insurer               text,
  incurred_claims       numeric,
  cashless_ratio        numeric,
  ibnr_pct              numeric,
  annualised_claims     numeric,
  weighted_average_lives numeric,
  per_life_claims_cost  numeric,
  inflation_pct         numeric,
  lives_quoted          integer,
  tpa_fee_pct           numeric,
  brokerage_pct         numeric,
  insurer_opex_pct      numeric,
  indicative_premium    numeric,
  computed_at           timestamptz not null default now(),
  computed_by           uuid references app_users (id) on delete restrict
);

comment on table burn_calculations is
  'Append-only per case (§10). Computed per insurer, because lives_quoted differs per insurer (§9 rule D-10).';

create index burn_calculations_case_idx on burn_calculations (case_id, computed_at desc);

-- --------------------------------------------------------------------------
-- RFQ and insurer response tracking (§7, §11)
-- --------------------------------------------------------------------------
create table rfqs (
  id                     uuid primary key default gen_random_uuid(),
  case_id                uuid not null references cases (id) on delete cascade,
  covers_added           jsonb not null default '[]'::jsonb,
  covers_removed         jsonb not null default '[]'::jsonb,
  deadline               timestamptz,
  compliance_reviewed_by uuid references app_users (id) on delete restrict,
  dispatched_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index rfqs_case_idx on rfqs (case_id);

create table compliance_reviews (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references cases (id) on delete cascade,
  rfq_id      uuid not null references rfqs (id) on delete cascade,
  reviewed_by uuid not null references app_users (id) on delete restrict,
  status      app.compliance_review_status not null,
  notes       text,
  reviewed_at timestamptz not null default now()
);

comment on table compliance_reviews is
  'The §7 dispatch gate. Dispatch may not skip this, even for Plum-exclusive-only cases.';

create table insurer_rfqs (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases (id) on delete cascade,
  rfq_id         uuid not null references rfqs (id) on delete cascade,
  insurer_name   text not null,
  status         app.insurer_rfq_status not null default 'sent',
  dispatched_at  timestamptz,
  decline_reason text,
  updated_at     timestamptz not null default now(),
  unique (rfq_id, insurer_name),

  -- §CLAUDE.md: a decline logs its evidence, not just a status flag.
  constraint insurer_rfqs_decline_has_reason
    check (status <> 'declined' or decline_reason is not null)
);

create index insurer_rfqs_case_status_idx on insurer_rfqs (case_id, status);

create table quote_versions (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases (id) on delete cascade,
  insurer_rfq_id uuid not null references insurer_rfqs (id) on delete cascade,
  version_no     integer not null,
  terms          jsonb not null default '{}'::jsonb,
  premium        numeric,
  lives_quoted   integer,
  received_at    timestamptz not null default now(),
  is_outlier     boolean not null default false,
  outlier_reason text,
  unique (insurer_rfq_id, version_no)
);

comment on column quote_versions.terms is 'Keyed by benefit_key (§4.1).';
comment on column quote_versions.lives_quoted is
  'Carried per quote because each insurer rates a different member count (rule D-10); a premium must never be shown without it.';

create index quote_versions_case_idx on quote_versions (case_id);

create table reminders_log (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases (id) on delete cascade,
  insurer_rfq_id uuid not null references insurer_rfqs (id) on delete cascade,
  reminder_type  text not null,
  sent_at        timestamptz not null default now()
);

create index reminders_log_insurer_rfq_idx on reminders_log (insurer_rfq_id, sent_at);

create table clarifications (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases (id) on delete cascade,
  insurer_rfq_id    uuid not null references insurer_rfqs (id) on delete cascade,
  sent_at           timestamptz not null default now(),
  deadline_24h      timestamptz not null,
  response_received boolean not null default false,
  deemed_accepted_at timestamptz,
  evidence_ref      text,

  -- Deemed acceptance is disputable later, so it must carry evidence rather
  -- than being a bare timestamp (§11, CLAUDE.md).
  constraint clarifications_deemed_acceptance_has_evidence
    check (deemed_accepted_at is null or evidence_ref is not null)
);

create index clarifications_insurer_rfq_idx on clarifications (insurer_rfq_id);

create table negotiation_rounds (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases (id) on delete cascade,
  round_no         integer not null,
  insurers_included jsonb not null default '[]'::jsonb,
  initiated_by     uuid not null references app_users (id) on delete restrict,
  initiated_at     timestamptz not null default now(),
  resolved_at      timestamptz,
  unique (case_id, round_no)
);

-- --------------------------------------------------------------------------
-- Customer-facing quote and decision (§13)
-- --------------------------------------------------------------------------
create table customer_quote_links (
  id                  uuid primary key default gen_random_uuid(),
  case_id             uuid not null references cases (id) on delete cascade,
  token_hash          text not null unique,
  preferred_insurer   text,
  created_by          uuid not null references app_users (id) on delete restrict,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz
);

comment on column customer_quote_links.token_hash is
  'Hash of the signed token, never the token itself: a database read must not yield a working link (§13, §16).';

create table customer_link_views (
  id                     uuid primary key default gen_random_uuid(),
  case_id                uuid not null references cases (id) on delete cascade,
  customer_quote_link_id uuid not null references customer_quote_links (id) on delete cascade,
  viewed_at              timestamptz not null default now(),
  section_viewed         text
);

comment on table customer_link_views is
  'View/section granularity only. This is engagement tracking, not surveillance (§13) — do not add finer-grained columns.';

create table customer_decisions (
  id                   uuid primary key default gen_random_uuid(),
  case_id              uuid not null unique references cases (id) on delete cascade,
  selected_insurer     text not null,
  decided_at           timestamptz not null default now(),
  consent_evidence_ref text not null,
  terms_snapshot       jsonb not null
);

comment on column customer_decisions.terms_snapshot is
  'The exact terms displayed at the moment of acceptance, stored alongside the consent evidence in case terms are later disputed (§13).';

-- --------------------------------------------------------------------------
-- issuance (§4.2, Phase 6)
-- --------------------------------------------------------------------------
create table issuance (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references cases (id) on delete cascade,
  insurer               text not null,
  issuance_requested_at timestamptz,
  certificate_ref       text,
  brokerage_reconciled  boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- updated_at triggers
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'salesforce_accounts','cases','policies','policy_terms','rfqs',
    'insurer_rfqs','issuance'
  ] loop
    execute format(
      'create trigger %I_touch_updated_at before update on %I
         for each row execute function app.touch_updated_at()', t, t);
  end loop;
end
$$;
