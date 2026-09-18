-- 110_rfq_gate.sql
-- Everything that has to be true before an insurer is asked to quote.
--
-- The gate is one function rather than a set of checks in the application, so
-- the screen that explains why an RFQ cannot go out and the action that refuses
-- to send it cannot drift apart. That only holds if the function is right, so
-- it is asserted here rather than in a page test.

begin;
select plan(12);

create temporary table gx (who text primary key, id uuid default gen_random_uuid());
insert into gx (who) values ('rm'), ('cust');
create or replace function gxid(text) returns uuid language sql stable as
  $$ select id from gx where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (gxid('rm'), 'gate-rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name) values (gxid('cust'), 'Gate Synthetic Pvt Ltd');

insert into cases (id, customer_id, owner_user_id)
values ('aaaa2222-0000-0000-0000-000000000001', gxid('cust'), gxid('rm'));

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label) values
  ('gate_benefit_one', 9001, 'The basics', 'Gate Benefit One'),
  ('gate_benefit_two', 9002, 'The basics', 'Gate Benefit Two')
on conflict (benefit_key) do nothing;

-- --------------------------------------------------------------------------
-- A new deal is blocked on everything, and says so in order.
-- --------------------------------------------------------------------------
select is(
  app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'),
  array['documents', 'member_data', 'policy_terms', 'rfq_options'],
  'A new deal is blocked on everything except claims, which has nothing to reconcile');

-- --------------------------------------------------------------------------
-- Each one clears independently.
-- --------------------------------------------------------------------------
insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by) values
  ('aaaa2222-0000-0000-0000-000000000001', 'policy_copy', 'a', 'p.pdf',  gxid('rm')),
  ('aaaa2222-0000-0000-0000-000000000001', 'member_data', 'b', 'm.xlsx', gxid('rm')),
  ('aaaa2222-0000-0000-0000-000000000001', 'claims_dump', 'c', 'c.xlsx', gxid('rm')),
  ('aaaa2222-0000-0000-0000-000000000001', 'claims_mis',  'd', 'i.pdf',  gxid('rm'));

select ok(
  not ('documents' = any(app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'))),
  'Holding all four documents clears that blocker');

insert into member_records (case_id, relationship, age)
values ('aaaa2222-0000-0000-0000-000000000001', 'self', 34);

select ok(
  not ('member_data' = any(app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'))),
  'A loaded roster clears that one');

-- --------------------------------------------------------------------------
-- Terms: a policy with unreviewed benefits does not count as reviewed.
-- --------------------------------------------------------------------------
insert into policies (id, case_id)
values ('bbbb2222-0000-0000-0000-000000000001', 'aaaa2222-0000-0000-0000-000000000001');

select ok(
  'policy_terms' = any(app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001')),
  'A policy with nothing reviewed on it still blocks — a blank policy is not a reviewed one');

insert into policy_terms (case_id, policy_id, benefit_key, value, source, review_status, reviewed_by, reviewed_at)
select 'aaaa2222-0000-0000-0000-000000000001', 'bbbb2222-0000-0000-0000-000000000001',
       b.benefit_key, 'Covered', 'manual', 'confirmed', gxid('rm'), now()
from benefit_catalogue b;

select ok(
  not ('policy_terms' = any(app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'))),
  'Every benefit decided clears the terms blocker');

-- --------------------------------------------------------------------------
-- An option to quote.
-- --------------------------------------------------------------------------
select is(
  app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'),
  array['rfq_options'],
  'Only the option is left');

insert into rfq_options (id, case_id, option_no, name, created_by)
values ('cccc2222-0000-0000-0000-000000000001', 'aaaa2222-0000-0000-0000-000000000001', 1,
        'Same as expiring', gxid('rm'));

select is(
  app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'),
  array[]::text[],
  'With an option, nothing blocks the RFQ');

-- --------------------------------------------------------------------------
-- Any one of them shuts it again, on its own account.
-- --------------------------------------------------------------------------
insert into claims_reconciliations (case_id, metric, stated_value, computed_value)
values ('aaaa2222-0000-0000-0000-000000000001', 'amount_settled', 100, 90);

select is(
  app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'),
  array['claims_reconciliation'],
  'An undecided claims figure shuts it again');

update claims_reconciliations
   set chosen = 'computed', chosen_value = 90, decided_by = gxid('rm'), decided_at = now();

delete from member_records where case_id = 'aaaa2222-0000-0000-0000-000000000001';

select is(
  app.rfq_blockers('aaaa2222-0000-0000-0000-000000000001'),
  array['member_data'],
  'and so does losing the roster');

-- --------------------------------------------------------------------------
-- The RFQ itself.
-- --------------------------------------------------------------------------
insert into member_records (case_id, relationship, age)
values ('aaaa2222-0000-0000-0000-000000000001', 'self', 34);

insert into rfqs (id, case_id, option_id)
values ('dddd2222-0000-0000-0000-000000000001', 'aaaa2222-0000-0000-0000-000000000001',
        'cccc2222-0000-0000-0000-000000000001');

select is(
  (select option_id from rfqs where id = 'dddd2222-0000-0000-0000-000000000001'),
  'cccc2222-0000-0000-0000-000000000001'::uuid,
  'An RFQ records which option it went out on, so a returning quote can be read against it');

select throws_ok(
  $$ insert into rfqs (case_id) values ('aaaa2222-0000-0000-0000-000000000001') $$,
  '23505', null,
  'One live RFQ per deal — two open at once is a state nobody could interpret');

select throws_ok(
  $$ delete from rfq_options where id = 'cccc2222-0000-0000-0000-000000000001' $$,
  '23503', null,
  'and the option an RFQ went out on cannot be deleted from under it');

select * from finish();
rollback;
