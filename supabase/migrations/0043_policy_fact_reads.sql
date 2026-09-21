-- ════════════════════════════════════════════════════════════════════════════
-- 0043 — what the policy said, against what was saved.
--
-- Asked a fair question of a deal — "was the incumbent broker read off the
-- policy or did I type it?" — the system could not answer. `case_events` said
-- "deal setup saved" and nothing about where any value came from.
--
-- The screen used to answer it, with a box listing everything read. That was
-- the wrong place: every value has to be validated anyway, so the box repeated
-- what was already in the fields below it, and it listed facts (sum insured,
-- lives) that no field on that step receives — which reads as captured when
-- nothing captured them.
--
-- So it is recorded instead. This is the same signal `policy_extraction_edits`
-- keeps for terms the model reads, for the fields rules read: per deal, per
-- field, what the document stated and what a person let stand.
-- ════════════════════════════════════════════════════════════════════════════

create table policy_fact_reads (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases (id) on delete cascade,
  case_document_id uuid references case_documents (id) on delete set null,

  -- The form field, not a benefit: these are deal facts, not policy terms.
  field            text not null,

  -- What the document said. Never changed once recorded — that is the whole
  -- point of it, so a correction can be measured against it later.
  read_value       text,
  read_page        integer,

  -- What is in the deal now. Updated whenever the step is saved.
  saved_value      text,
  read_at          timestamptz not null default now(),
  settled_at       timestamptz not null default now(),

  unique (case_id, field)
);

comment on table policy_fact_reads is
  'Per deal and field: what the policy copy stated, and what the deal ended up holding. Answers "read or typed?" permanently, and measures the parser against what people let stand.';
comment on column policy_fact_reads.read_value is
  'Immutable. A correction is only meaningful against the original reading, so re-reading the same document never rewrites it.';

create index policy_fact_reads_case_idx on policy_fact_reads (case_id);
create index policy_fact_reads_field_idx on policy_fact_reads (field);

-- --------------------------------------------------------------------------
-- The reading is a fact about a document and does not get to change.
-- --------------------------------------------------------------------------
create or replace function app.policy_fact_read_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.read_value is distinct from old.read_value
     or new.read_page is distinct from old.read_page then
    raise exception
      'What the policy said about % cannot be rewritten. Record a new saved_value instead.',
      old.field
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger policy_fact_reads_reading_is_immutable
  before update on policy_fact_reads
  for each row
  execute function app.policy_fact_read_is_immutable();

-- --------------------------------------------------------------------------
-- How the parser is doing, per field, across every deal.
--
-- The question this table exists to answer in aggregate: which fields can be
-- trusted to fill themselves, and which are corrected often enough that
-- offering them is costing more attention than it saves.
-- --------------------------------------------------------------------------
create or replace function app.policy_read_accuracy()
returns table (field text, readings bigint, accepted bigint, corrected bigint)
language sql
stable
as $$
  select r.field,
         count(*) as readings,
         count(*) filter (where r.saved_value is not distinct from r.read_value) as accepted,
         count(*) filter (where r.saved_value is distinct from r.read_value)     as corrected
    from policy_fact_reads r
   where r.read_value is not null
   group by r.field
   order by count(*) desc;
$$;

grant execute on function app.policy_read_accuracy() to authenticated, service_role;

alter table policy_fact_reads enable row level security;

create policy policy_fact_reads_select on policy_fact_reads for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));

create policy policy_fact_reads_insert on policy_fact_reads for insert to authenticated
  with check (app.can_write_case(app.case_owner(case_id)));

create policy policy_fact_reads_update on policy_fact_reads for update to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

grant select, insert, update on policy_fact_reads to authenticated;
