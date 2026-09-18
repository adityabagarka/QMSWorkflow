-- ════════════════════════════════════════════════════════════════════════════
-- 0030 — where the insurer's figures and ours disagree, somebody chooses.
--
-- ADR 0011 rule 5. The claims MIS states figures we can also compute from the
-- raw dump, and when the two differ neither silently wins: both are shown and
-- the RM chooses explicitly before the RFQ can be built.
--
-- This is deliberate rather than fussy. A gap between what an insurer reports
-- and what their own data shows is frequently the most negotiable thing in the
-- file — a tool that quietly picked one number would discard the single most
-- useful signal on the screen, and would do it invisibly.
--
-- The shape mirrors member_deviations: detected automatically, decided by a
-- person, and the decision carries its evidence rather than being a status flag
-- (§9, §11, CLAUDE.md).
-- ════════════════════════════════════════════════════════════════════════════

create table claims_reconciliations (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references cases (id) on delete cascade,

  metric         text not null,
  stated_value   numeric not null,   -- what the insurer's MIS says
  computed_value numeric not null,   -- what their own dump adds up to

  -- Null until somebody decides. That is the whole point: an undecided
  -- discrepancy holds the RFQ, and "undecided" has to be representable.
  chosen         text,
  -- The figure that goes forward. Usually one of the two above; where the RM
  -- believes neither, they supply the number they will actually quote on.
  chosen_value   numeric,

  note           text,
  decided_by     uuid references app_users (id) on delete restrict,
  decided_at     timestamptz,
  detected_at    timestamptz not null default now(),

  unique (case_id, metric),

  constraint claims_reconciliations_choice_known check (
    chosen is null or chosen in ('stated', 'computed', 'neither')
  ),

  -- A decision must say who made it and when: this is evidence an insurer or a
  -- customer may question later, not a flag.
  constraint claims_reconciliations_attributable check (
    chosen is null or (decided_by is not null and decided_at is not null)
  ),

  -- Choosing neither means naming the figure you are quoting on, and saying
  -- why. "Neither of these" on its own moves the problem rather than settling
  -- it.
  constraint claims_reconciliations_neither_is_explained check (
    chosen is distinct from 'neither'
    or (chosen_value is not null and length(trim(coalesce(note, ''))) > 0)
  ),

  -- A resolved row carries the figure that goes forward, whichever it is.
  constraint claims_reconciliations_resolved_has_value check (
    chosen is null or chosen_value is not null
  )
);

comment on table claims_reconciliations is
  'Disagreements between the insurer''s stated claims figures and the same figures computed from their dump. Undecided rows hold the RFQ (ADR 0011 rule 5).';

create index claims_reconciliations_case_idx on claims_reconciliations (case_id);

alter table claims_reconciliations enable row level security;

create policy claims_reconciliations_select on claims_reconciliations for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));
create policy claims_reconciliations_write on claims_reconciliations for all to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

grant select, insert, update, delete on claims_reconciliations to authenticated;

-- --------------------------------------------------------------------------
-- The gate.
-- --------------------------------------------------------------------------
create or replace function app.claims_unreconciled(p_case_id uuid)
returns table (metric text, stated numeric, computed numeric)
language sql
stable
as $$
  select r.metric, r.stated_value, r.computed_value
  from claims_reconciliations r
  where r.case_id = p_case_id and r.chosen is null
  order by r.metric;
$$;

create or replace function app.claims_reconciled(p_case_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from claims_reconciliations
    where case_id = p_case_id and chosen is null
  );
$$;

comment on function app.claims_reconciled(uuid) is
  'True when every detected disagreement between the MIS and the dump has been decided. A case with no disagreements is reconciled trivially, which is correct — there is nothing to choose.';

grant execute on function
  app.claims_unreconciled(uuid),
  app.claims_reconciled(uuid)
to authenticated, service_role;

-- --------------------------------------------------------------------------
-- What still stands between this case and a dispatched RFQ.
--
-- One function rather than three checks in the application, so the answer is
-- the same wherever it is asked and cannot drift between the screen that shows
-- it and the action that enforces it.
-- --------------------------------------------------------------------------
create or replace function app.rfq_blockers(p_case_id uuid)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(blocker order by ord), array[]::text[])
  from (
    select 'documents' as blocker, 1 as ord
    where not app.case_documents_complete(p_case_id)
    union all
    select 'claims_reconciliation', 2
    where not app.claims_reconciled(p_case_id)
  ) blockers;
$$;

comment on function app.rfq_blockers(uuid) is
  'Why an RFQ cannot be dispatched yet. Empty means nothing is outstanding. Policy term review is checked per-policy by app.policy_review_complete and is added here when the RFQ step is built.';

grant execute on function app.rfq_blockers(uuid) to authenticated, service_role;
