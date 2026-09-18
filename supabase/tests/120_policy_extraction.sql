-- 120_policy_extraction.sql
-- What has to be true of a term a machine wrote.
--
-- The screen asks for confirmation, shows the clause and never marks anything
-- reviewed on its own. None of that is a guarantee: a screen is where a rule is
-- most easily forgotten, and the whole point of these terms is that an insurer
-- quotes against them. So the rules live in the table and are asserted here.

begin;
select plan(14);

create temporary table ex (who text primary key, id uuid default gen_random_uuid());
insert into ex (who) values ('rm'), ('cust');
create or replace function exid(text) returns uuid language sql stable as
  $$ select id from ex where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (exid('rm'), 'extract-rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name, gstin)
values (exid('cust'), 'Extraction Synthetic Pvt Ltd', '99AAECX1234N1Z5');

insert into cases (id, customer_id, owner_user_id)
values ('bbbb3333-0000-0000-0000-000000000001', exid('cust'), exid('rm'));

insert into policies (id, case_id)
values ('bbbb3333-0000-0000-0000-000000000002', 'bbbb3333-0000-0000-0000-000000000001');

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label) values
  ('extract_benefit_one', 9101, 'The basics', 'Extract Benefit One'),
  ('extract_benefit_two', 9102, 'The basics', 'Extract Benefit Two')
on conflict (benefit_key) do nothing;

insert into case_documents (id, case_id, kind, file_name, file_ref, uploaded_by)
values ('bbbb3333-0000-0000-0000-000000000003', 'bbbb3333-0000-0000-0000-000000000001',
        'policy_copy', 'synthetic-policy.pdf',
        'cases/bbbb3333-0000-0000-0000-000000000001/policy_copy/synthetic-policy.pdf',
        exid('rm'));

-- --------------------------------------------------------------------------
-- A run names exactly one document.
--
-- `policy_documents` predates the documents step and nothing fills it; the app
-- writes `case_documents`. Both columns exist so the §4.2 shape survives, which
-- only works if a row cannot claim both or neither.
-- --------------------------------------------------------------------------
select lives_ok(
  $$ insert into policy_extractions (id, case_id, case_document_id, status)
     values ('bbbb3333-0000-0000-0000-00000000000a',
             'bbbb3333-0000-0000-0000-000000000001',
             'bbbb3333-0000-0000-0000-000000000003', 'running') $$,
  'an extraction can name the document the user actually uploaded'
);

select throws_ok(
  $$ insert into policy_extractions (case_id, status)
     values ('bbbb3333-0000-0000-0000-000000000001', 'running') $$,
  23514,
  null,
  'an extraction naming no document is refused'
);

select is(
  (select status::text from policy_extractions where id = 'bbbb3333-0000-0000-0000-00000000000a'),
  'running',
  'a run is recorded before it finishes, so a run that dies leaves a trace'
);

-- --------------------------------------------------------------------------
-- An extracted value carries the clause it was read from.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into policy_terms (case_id, policy_id, benefit_key, value, source)
     values ('bbbb3333-0000-0000-0000-000000000001', 'bbbb3333-0000-0000-0000-000000000002',
             'extract_benefit_one', 'Rs. 5,000 per day', 'extracted') $$,
  23514,
  null,
  'an extracted value with no quote behind it is refused'
);

select lives_ok(
  $$ insert into policy_terms
       (case_id, policy_id, benefit_key, value, source, evidence_quote, evidence_page,
        extraction_id, extraction_confidence)
     values ('bbbb3333-0000-0000-0000-000000000001', 'bbbb3333-0000-0000-0000-000000000002',
             'extract_benefit_one', 'Rs. 5,000 per day', 'extracted',
             'Room rent is payable up to Rs. 5,000 per day.', 12,
             'bbbb3333-0000-0000-0000-00000000000a', 0.88) $$,
  'an extracted value with its clause is accepted'
);

-- "Not stated" is a real finding about a rollover, so it has to be storable.
select lives_ok(
  $$ insert into policy_terms (case_id, policy_id, benefit_key, value, source, extraction_id)
     values ('bbbb3333-0000-0000-0000-000000000001', 'bbbb3333-0000-0000-0000-000000000002',
             'extract_benefit_two', null, 'extracted',
             'bbbb3333-0000-0000-0000-00000000000a') $$,
  'a benefit the policy does not state is recorded without a quote'
);

-- A term somebody typed is not making a claim about a document.
select lives_ok(
  $$ update policy_terms set value = 'Rs. 6,000 per day', source = 'manual', evidence_quote = null,
            review_status = 'corrected', reviewed_by = exid('rm'), reviewed_at = now()
      where benefit_key = 'extract_benefit_one'
        and policy_id = 'bbbb3333-0000-0000-0000-000000000002' $$,
  'a value a person typed needs no quote'
);

select throws_ok(
  $$ update policy_terms set evidence_page = 0
      where benefit_key = 'extract_benefit_two'
        and policy_id = 'bbbb3333-0000-0000-0000-000000000002' $$,
  23514,
  null,
  'page zero is not a page'
);

-- --------------------------------------------------------------------------
-- The model proposes; a person reviews.
--
-- This is the rule that keeps an estimate from becoming a quote. The trigger
-- makes it true of the table, so no caller — this app, a script, a future
-- background job — can write a term that arrives already agreed with.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into policy_terms
       (case_id, policy_id, benefit_key, value, source, evidence_quote,
        review_status, reviewed_by, reviewed_at)
     values ('bbbb3333-0000-0000-0000-000000000001', 'bbbb3333-0000-0000-0000-000000000002',
             'extract_benefit_two', 'Covered', 'extracted', 'The benefit is covered.',
             'confirmed', exid('rm'), now()) $$,
  23514,
  null,
  'an extraction cannot write a term that is already confirmed'
);

select is(
  (select review_status::text from policy_terms
    where benefit_key = 'extract_benefit_two'
      and policy_id = 'bbbb3333-0000-0000-0000-000000000002'),
  'proposed',
  'an extracted term starts unreviewed'
);

-- A person confirming afterwards is the whole point, and must still work.
select lives_ok(
  $$ update policy_terms
        set review_status = 'confirmed', reviewed_by = exid('rm'), reviewed_at = now()
      where benefit_key = 'extract_benefit_two'
        and policy_id = 'bbbb3333-0000-0000-0000-000000000002' $$,
  'a person can confirm an extracted term'
);

-- --------------------------------------------------------------------------
-- The gate in 0017 still decides, and now has extracted terms to decide about.
--
-- Asserted over this policy's own terms. Neither `policy_review_complete` nor
-- `policy_review_outstanding` fits: since 0026 both also ask whether every
-- benefit in the catalogue has been answered, which is a question about
-- whatever the catalogue happens to hold — a measurement of the database
-- rather than of these fixtures (see the README). That the gate counts an
-- unanswered benefit as outstanding is 050's assertion, not this suite's.
-- --------------------------------------------------------------------------
select is(
  (select count(*)::int from policy_terms
    where policy_id = 'bbbb3333-0000-0000-0000-000000000002'
      and review_status = 'proposed'),
  0,
  'once reviewed, neither extracted term is still proposed'
);

-- --------------------------------------------------------------------------
-- The edits table stays the record of what the model got wrong.
-- --------------------------------------------------------------------------
select lives_ok(
  $$ insert into policy_extraction_edits
       (case_id, extraction_id, benefit_key, original_value, corrected_value, corrected_by)
     values ('bbbb3333-0000-0000-0000-000000000001',
             'bbbb3333-0000-0000-0000-00000000000a', 'extract_benefit_one',
             'Rs. 5,000 per day', 'Rs. 6,000 per day', exid('rm')) $$,
  'a correction is recorded against the run that proposed it'
);

select is(
  (select count(*)::int from policy_extraction_edits
    where extraction_id = 'bbbb3333-0000-0000-0000-00000000000a'),
  1,
  'the correction is retained for measuring the reader against its reviews'
);

select * from finish();
rollback;
