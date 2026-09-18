-- ════════════════════════════════════════════════════════════════════════════
-- 0029 — claim-level history, and the insurer's own account of it.
--
-- `claims_uploads` recorded that a file arrived and `burn_calculations` recorded
-- a result, with nothing in between: the claims themselves had nowhere to live,
-- so a burn figure could not be traced back to the rows it came from.
--
-- Two tables, because there are two independent accounts of the same history
-- and ADR 0011 rule 5 turns a disagreement between them into a decision rather
-- than a display. Keeping the insurer's stated figures apart from our own
-- computation is what makes the disagreement visible at all; merging them into
-- one "claims summary" would quietly pick a winner.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Claim-level rows, as the dump gives them.
-- --------------------------------------------------------------------------
create table claim_records (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases (id) on delete cascade,
  claims_upload_id uuid references claims_uploads (id) on delete set null,

  claim_ref        text,
  member_ref       text,          -- whatever the dump uses to identify the life
  relationship     text,
  claim_type       text,          -- cashless / reimbursement, as stated
  status           text,          -- settled / rejected / outstanding, as stated
  incurred_on      date,
  reported_on      date,
  claimed_amount   numeric,
  paid_amount      numeric,
  diagnosis        text,

  /*
   * The row as it arrived, before any mapping.
   *
   * Kept because a claims dump is evidence: when a computed figure is disputed
   * — and ADR 0011 rule 5 exists because it will be — the answer has to be
   * traceable to what the insurer actually sent, not to our interpretation of
   * it. It also means a column we mapped wrongly can be remapped without asking
   * for the file again.
   */
  source_row       jsonb not null default '{}'::jsonb,
  row_number       integer,

  created_at       timestamptz not null default now()
);

comment on table claim_records is
  'Claim-level history from the insurer dump. source_row keeps the original, so a computed figure can always be traced back to what arrived.';

create index claim_records_case_idx on claim_records (case_id);
create index claim_records_incurred_idx on claim_records (case_id, incurred_on);

-- --------------------------------------------------------------------------
-- 2. What the insurer's MIS says.
--
-- Stated, not computed. These are the figures we read against our own, and the
-- gap between the two is frequently the most negotiable thing in the file — so
-- they are recorded as the insurer's claim about the history rather than as the
-- history itself.
-- --------------------------------------------------------------------------
create table claims_stated_figures (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases (id) on delete cascade,
  document_id   uuid references case_documents (id) on delete set null,

  metric        text not null,
  value         numeric not null,
  -- Where in the file it was found, so a disputed figure can be pointed at.
  source_label  text,

  created_at    timestamptz not null default now(),

  constraint claims_stated_metric_known check (metric in (
    'claims_reported',     -- count
    'claims_settled',      -- count
    'claims_outstanding',  -- count
    'claims_rejected',     -- count
    'amount_claimed',
    'amount_settled',
    'amount_outstanding',
    'premium',
    'incurred_claims_ratio'
  )),

  unique (case_id, metric)
);

comment on table claims_stated_figures is
  'Figures the insurer states in its MIS. Deliberately separate from anything computed from claim_records: a disagreement between the two is a decision for the RM (ADR 0011 rule 5), and one merged table would hide it.';

-- --------------------------------------------------------------------------
-- 3. RLS. Both inherit the permissions of their case, like every other
--    case-scoped table.
-- --------------------------------------------------------------------------
alter table claim_records enable row level security;
alter table claims_stated_figures enable row level security;

create policy claim_records_select on claim_records for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));
create policy claim_records_write on claim_records for all to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

create policy claims_stated_select on claims_stated_figures for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));
create policy claims_stated_write on claims_stated_figures for all to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

grant select, insert, update, delete on claim_records to authenticated;
grant select, insert, update, delete on claims_stated_figures to authenticated;
