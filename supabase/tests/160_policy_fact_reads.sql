-- 160_policy_fact_reads.sql
-- What the policy said, against what a person let stand.
--
-- Asked of a real deal whether the incumbent broker was read off the policy or
-- typed, the system could not say. The screen used to answer it with a box
-- listing every reading, which repeated what was already in the fields below
-- and listed facts no field receives. Recorded instead: on the deal, and in
-- aggregate as the parser's accuracy per field.

begin;
select plan(8);

create temporary table rx (who text primary key, id uuid default gen_random_uuid());
insert into rx (who) values ('rm'), ('cust');
create or replace function rxid(text) returns uuid language sql stable as
  $$ select id from rx where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (rxid('rm'), 'reads-rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name, gstin)
values (rxid('cust'), 'Reads Synthetic Pvt Ltd', '99AAECR1234N1Z5');

insert into cases (id, customer_id, owner_user_id)
values ('ffff7777-0000-0000-0000-000000000001', rxid('cust'), rxid('rm'));

insert into case_documents (id, case_id, kind, file_name, file_ref, uploaded_by)
values ('ffff7777-0000-0000-0000-000000000002', 'ffff7777-0000-0000-0000-000000000001',
        'policy_copy', 'synthetic.pdf',
        'cases/ffff7777-0000-0000-0000-000000000001/policy_copy/synthetic.pdf', rxid('rm'));

insert into policy_fact_reads
  (case_id, case_document_id, field, read_value, read_page, saved_value)
values
  ('ffff7777-0000-0000-0000-000000000001', 'ffff7777-0000-0000-0000-000000000002',
   'insurer_name', 'ICICI Lombard', 1, 'ICICI Lombard'),
  ('ffff7777-0000-0000-0000-000000000001', 'ffff7777-0000-0000-0000-000000000002',
   'broker_name', 'Plum', 9, 'Plum');

select is(
  (select count(*)::int from policy_fact_reads where case_id = 'ffff7777-0000-0000-0000-000000000001'),
  2,
  'a reading is recorded per field'
);

-- --------------------------------------------------------------------------
-- The reading is a fact about a document.
--
-- A correction only means anything measured against what was originally read,
-- so re-reading the same file must never rewrite it.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update policy_fact_reads set read_value = 'Something else'
      where case_id = 'ffff7777-0000-0000-0000-000000000001' and field = 'broker_name' $$,
  23514,
  null,
  'what the policy said cannot be rewritten'
);

select lives_ok(
  $$ update policy_fact_reads set saved_value = 'Marsh', settled_at = now()
      where case_id = 'ffff7777-0000-0000-0000-000000000001' and field = 'broker_name' $$,
  'but what the deal now holds is updated freely'
);

select is(
  (select read_value from policy_fact_reads
    where case_id = 'ffff7777-0000-0000-0000-000000000001' and field = 'broker_name'),
  'Plum',
  'and the original reading survives the correction'
);

select is(
  (select count(*)::int from policy_fact_reads
    where case_id = 'ffff7777-0000-0000-0000-000000000001'
      and field = 'broker_name'),
  1,
  'one row per field — re-saving a deal does not accumulate rows'
);

-- --------------------------------------------------------------------------
-- What it is for in aggregate: which fields fill themselves reliably.
-- --------------------------------------------------------------------------
select is(
  (select corrected from app.policy_read_accuracy() where field = 'broker_name'),
  1::bigint,
  'a value somebody changed counts as corrected'
);

select is(
  (select accepted from app.policy_read_accuracy() where field = 'insurer_name'),
  1::bigint,
  'and one they let stand counts as accepted'
);

-- --------------------------------------------------------------------------
-- It belongs to the deal, and goes with it.
-- --------------------------------------------------------------------------
delete from cases where id = 'ffff7777-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from policy_fact_reads
    where case_id = 'ffff7777-0000-0000-0000-000000000001'),
  0,
  'the readings go with the deal they describe'
);

select * from finish();
rollback;
