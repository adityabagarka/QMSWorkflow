-- 0015_member_deviations.sql
-- Deviations between the member roster and the terms that govern it.
--
-- This is the structural difference between the rollover workflow and the
-- pre-approved plan workflow, and it inverts the rule.
--
-- In the pre-approved workflow, eligibility comes from our SKU guardrails, and
-- a member who falls outside them is DROPPED from rated_lives and logged to
-- member_data_exclusions (rule F-04). The plan is fixed; the roster is filtered
-- to fit it.
--
-- In a rollover, eligibility comes from the EXPIRING POLICY'S TERMS, and a
-- member who falls outside them is KEPT and FLAGGED. The roster is the fact;
-- the plan is built around it. A parent aged 82 under an 80-year limit is
-- covered as a continuation of the expiring policy — dropping them would
-- silently shrink the cover the customer already has. What they need instead is
-- to be disclosed to the insurer, because while that life continues, a NEW life
-- over 80 would not be accepted.
--
-- So a deviation is not an error. It is a disclosure: something the RM must see
-- before the RFQ goes out, decide on, and — if accepted — carry into the RFQ
-- pack so the insurer prices with full knowledge. Getting this wrong is exactly
-- what causes the insurer queries and quote delays this system exists to
-- prevent.

create type app.deviation_source as enum ('expiring_policy', 'rfq');

create type app.deviation_status as enum (
  'flagged',   -- detected, awaiting a decision
  'accepted',  -- carried into the RFQ pack as a disclosed deviation
  'removed'    -- the member is withdrawn from the roster instead
);

create table member_deviations (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases (id) on delete cascade,
  member_record_id uuid not null references member_records (id) on delete cascade,

  -- Which term is breached. Always a benefit_key, never a free-text field name:
  -- §4.1 makes benefit_catalogue the one schema for policy terms, RFQ terms and
  -- the comparison table, so a deviation points at the same key the RFQ will.
  benefit_key      text not null references benefit_catalogue (benefit_key) on delete restrict,

  -- Terms are checked twice: against the expiring policy when the roster is
  -- uploaded, and again against the RFQ once its terms are set, since the RFQ
  -- may ask for something narrower or wider than the expiring policy.
  source           app.deviation_source not null,

  expected_value   text,          -- what the governing term permits
  actual_value     text,          -- what the member record says
  detail           text not null, -- the explanation an RM reads, and the insurer eventually sees

  -- A life already on the expiring policy is a continuation: the insurer is
  -- being asked to carry someone they already carry, which is a different ask
  -- from admitting a new life outside the limits. The distinction changes how
  -- the deviation is worded to the insurer, so it is recorded rather than
  -- inferred later.
  is_continuation  boolean not null default false,

  status           app.deviation_status not null default 'flagged',
  decided_by       uuid references app_users (id) on delete restrict,
  decided_at       timestamptz,
  decision_note    text,
  detected_at      timestamptz not null default now(),

  -- One deviation per member per term per source; re-running detection updates
  -- rather than duplicating.
  unique (member_record_id, benefit_key, source),

  -- A decision must say who made it and when. This is evidence an insurer or a
  -- customer may question later, not a status flag (CLAUDE.md, §11).
  constraint member_deviations_decision_is_attributable check (
    status = 'flagged'
    or (decided_by is not null and decided_at is not null)
  )
);

comment on table member_deviations is
  'Members kept but disclosed, because they fall outside the governing terms. Distinct from member_data_exclusions, which records members dropped for failing an insurer guardrail in the pre-approved plan flow.';
comment on column member_deviations.is_continuation is
  'True where the life is already on the expiring policy. A continuation is a different request to an insurer than a new life outside the limits, and is worded differently in the RFQ.';

create index member_deviations_case_status_idx on member_deviations (case_id, status);
create index member_deviations_member_idx on member_deviations (member_record_id);

-- --------------------------------------------------------------------------
-- RLS. A new case-descendant table gets the same treatment as every other:
-- read it if you can read the case, write it if you can write the case (§15).
-- --------------------------------------------------------------------------
alter table member_deviations enable row level security;

create policy member_deviations_select on member_deviations for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));

create policy member_deviations_insert on member_deviations for insert to authenticated
  with check (app.can_write_case(app.case_owner(case_id)));

create policy member_deviations_update on member_deviations for update to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

create policy member_deviations_delete on member_deviations for delete to authenticated
  using (app.is_super_admin());

grant select, insert, update, delete on member_deviations to authenticated, service_role;
