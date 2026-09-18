-- ════════════════════════════════════════════════════════════════════════════
-- 0032 — reading the expiring policy, and keeping the evidence for it.
--
-- Reference: ARCHITECTURE.md §8; ADR 0011 rule 3; ADR 0012.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Extraction reads the document the user actually uploaded.
--
-- `policy_extractions.policy_document_id` points at `policy_documents`, which
-- the app has not written to since the documents step landed (0028): every
-- upload goes to `case_documents`. Rather than move the older table's rows or
-- leave extraction pointing at a table nothing fills, the extraction can now
-- name either — exactly one of them — so the §4.2 shape survives and the code
-- has somewhere real to point.
-- --------------------------------------------------------------------------
alter table policy_extractions
  alter column policy_document_id drop not null,
  add column case_document_id uuid references case_documents (id) on delete cascade,

  add constraint policy_extractions_has_one_document check (
    (policy_document_id is null) <> (case_document_id is null)
  );

create index policy_extractions_case_document_idx
  on policy_extractions (case_document_id);

-- --------------------------------------------------------------------------
-- 2. A term says where it came from.
--
-- A value read out of a policy by a model is a claim about a document, and the
-- house rule is that a claim of that kind carries its evidence rather than a
-- status flag (§9, §11). Here that means the sentence the value was read from
-- and the page it was on: enough for the reviewer to check the term without
-- hunting, and enough to argue about later with an insurer who reads the same
-- clause differently.
--
-- Nullable, because a term typed in by hand has no quote to carry — but an
-- extracted one with a value must, which the constraint below requires.
-- --------------------------------------------------------------------------
alter table policy_terms
  add column evidence_quote text,
  add column evidence_page integer,
  add column extraction_id uuid references policy_extractions (id) on delete set null,

  add constraint policy_terms_extracted_value_shows_evidence check (
    source <> 'extracted'
    or value is null
    or evidence_quote is not null
  ),

  add constraint policy_terms_evidence_page_is_a_page check (
    evidence_page is null or evidence_page >= 1
  );

comment on column policy_terms.evidence_quote is
  'The sentence in the policy this value was read from, verbatim. Required for an extracted term that has a value: a term nobody can trace is not reviewable, and a reviewer confirming one would be confirming the model rather than the policy.';
comment on column policy_terms.evidence_page is
  '1-indexed page of the policy copy the quote is on. Null when the reader could not place it.';
comment on column policy_terms.extraction_id is
  'Which run produced this term. Kept after review so a confirmed or corrected value can still be traced back to the run — and so a run can be measured by what its terms became.';

-- --------------------------------------------------------------------------
-- 3. An extracted term starts unreviewed.
--
-- 0017 already defaults review_status to 'proposed' and the RFQ gate already
-- refuses a policy carrying proposed terms. Said here as well, because this is
-- the migration that makes a machine able to write terms: nothing an extraction
-- writes may arrive already confirmed, whatever the code asks for.
-- --------------------------------------------------------------------------
create or replace function app.extracted_terms_start_unreviewed()
returns trigger
language plpgsql
as $$
begin
  if new.source = 'extracted' and new.review_status <> 'proposed' then
    raise exception
      'An extracted term cannot be created already reviewed (benefit %). A human confirms or corrects it afterwards.',
      new.benefit_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger policy_terms_extracted_start_unreviewed
  before insert on policy_terms
  for each row
  execute function app.extracted_terms_start_unreviewed();

comment on function app.extracted_terms_start_unreviewed() is
  'ADR 0012: an estimate must not be able to become a quote without a person in between. The model proposes; review is a human act, and this makes that true of the table rather than only of the screen.';
