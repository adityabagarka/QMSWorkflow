-- 050_policy_review_gate.sql
-- The gate that stops unreviewed policy terms reaching an RFQ (ADR 0009).
--
-- Asserted in the database rather than only through the screen, because the
-- screen is where a check is most easily forgotten and this one decides whether
-- an insurer is quoted terms nobody read.

begin;
select plan(17);

create temporary table fx (who text primary key, id uuid default gen_random_uuid());
insert into fx (who) values ('rm'), ('cust');

create or replace function fxid(text) returns uuid language sql stable as
  $$ select id from fx where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (fxid('rm'), 'rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name)
values (fxid('cust'), 'Synthetic Rollover Ltd');

insert into cases (id, customer_id, owner_user_id)
values ('11111111-1111-1111-1111-111111111111', fxid('cust'), fxid('rm'));

insert into policies (id, case_id, insurer_name)
values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'ICICI Lombard');

-- The benefit keys used below, in case this runs before the guardrails workbook
-- has been imported. On a loaded database these already exist and the insert is
-- a no-op; the suite must not depend on import order either way.
--
-- The fourth is there precisely because the suite DID depend on import order
-- and nobody noticed, since CI's pgTAP step had never actually run. The
-- coverage assertion further down — "reviewing the terms that exist is not
-- enough" — is only meaningful when the catalogue holds a benefit this policy
-- has no term for. On a loaded database the real catalogue supplies dozens; on
-- an empty one the seed above supplied exactly the three the policy covers, so
-- the assertion quietly became "three of three is not complete" and failed.
-- This one is never given a term until the sweep at the end, which is what
-- makes the assertion about coverage rather than about import order.
insert into benefit_catalogue (benefit_key, display_order, section, benefit_label) values
  ('members_covered', 1, 'The basics', 'Members Covered'),
  ('max_age_parents', 8, 'The basics', 'Max age - Parents'),
  ('room_rent_limit_normal_room', 31, 'Sum insured, limits & copay', 'Room rent limit - Normal room'),
  ('maternity_cover', 45, 'Mother & Child', 'Maternity Cover')
on conflict (benefit_key) do nothing;

-- Three terms across two sections, as an extraction would leave them.
insert into policy_terms (case_id, policy_id, benefit_key, value, source, extraction_confidence)
values
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'members_covered', 'Employee, Spouse, Children', 'extracted', 0.94),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'max_age_parents', '80', 'extracted', 0.41),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   'room_rent_limit_normal_room', 'Single private AC room', 'extracted', 0.67);

-- --------------------------------------------------------------------------
-- A blank policy is not complete.
--
-- The gate originally asked "is anything marked proposed?", which is vacuously
-- false when nothing has been entered — so a policy with no terms at all
-- reported itself ready for RFQ. A gate that opens on the very case it exists
-- to catch is worse than none, because it is trusted.
-- --------------------------------------------------------------------------
-- Its own case: policies.case_id is unique, since a rollover has exactly one
-- expiring policy.
insert into cases (id, customer_id, owner_user_id)
values ('44444444-4444-4444-4444-444444444444', fxid('cust'), fxid('rm'));
insert into policies (id, case_id)
values ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444');

select ok(
  not app.policy_review_complete('33333333-3333-3333-3333-333333333333'),
  'A policy with no terms entered at all is NOT ready for RFQ');

select is(
  (select decided from app.policy_review_progress('33333333-3333-3333-3333-333333333333'))::int,
  0,
  'A blank policy has decided nothing');

select ok(
  (select total from app.policy_review_progress('33333333-3333-3333-3333-333333333333')) > 0,
  'Progress is measured against the whole benefit catalogue, not against rows that happen to exist');

-- --------------------------------------------------------------------------
-- Nothing arrives pre-approved (ADR 0009 §1).
-- --------------------------------------------------------------------------
select is(
  (select count(*) from policy_terms where review_status = 'proposed')::int, 3,
  'Extracted terms land as proposed, never as reviewed');

select ok(
  not app.policy_review_complete('22222222-2222-2222-2222-222222222222'),
  'A policy with unreviewed terms is not ready for RFQ');

-- Every section is outstanding here, because only three of the catalogue's
-- benefits have been entered at all. Before 0020 this reported only the two
-- sections that happened to contain a row, which flattered the state of the
-- policy considerably.
select is(
  (select count(*) from app.policy_review_outstanding('22222222-2222-2222-2222-222222222222'))::int,
  (select count(distinct section) from benefit_catalogue)::int,
  'Outstanding work is reported per section, counting benefits never entered as well as unreviewed ones');

-- --------------------------------------------------------------------------
-- A review must be attributable (ADR 0009, "What gets recorded").
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update policy_terms set review_status = 'confirmed'
     where benefit_key = 'max_age_parents' $$,
  '23514', null,
  'A term cannot be marked reviewed without saying who reviewed it');

select throws_ok(
  format($q$ update policy_terms set review_status = 'confirmed', reviewed_by = %L
             where benefit_key = 'max_age_parents' $q$, fxid('rm')),
  '23514', null,
  'A review without a timestamp is refused too');

-- --------------------------------------------------------------------------
-- Confirmed and corrected stay distinct, because the difference is the
-- measurement of whether extraction is working.
-- --------------------------------------------------------------------------
select lives_ok(
  format($q$ update policy_terms
             set review_status = 'confirmed', reviewed_by = %L, reviewed_at = now()
             where benefit_key = 'members_covered' $q$, fxid('rm')),
  'A term the model got right is confirmed');

select lives_ok(
  format($q$ update policy_terms
             set value = '75', review_status = 'corrected', reviewed_by = %L, reviewed_at = now()
             where benefit_key = 'max_age_parents' $q$, fxid('rm')),
  'A term the model got wrong is corrected');

select is(
  (select count(*) from policy_terms where review_status = 'corrected')::int, 1,
  'A correction is distinguishable from a confirmation afterwards');

-- --------------------------------------------------------------------------
-- The gate opens only when nothing is outstanding.
-- --------------------------------------------------------------------------
select ok(
  not app.policy_review_complete('22222222-2222-2222-2222-222222222222'),
  'One unreviewed term still holds the gate shut');

select lives_ok(
  format($q$ update policy_terms
             set review_status = 'confirmed', reviewed_by = %L, reviewed_at = now()
             where benefit_key = 'room_rent_limit_normal_room' $q$, fxid('rm')),
  'The last outstanding term is reviewed');

-- Three terms reviewed is still not the whole catalogue, so the gate holds.
select ok(
  not app.policy_review_complete('22222222-2222-2222-2222-222222222222'),
  'Reviewing the terms that exist is not enough — every benefit must be decided');

-- Decide the rest. A benefit the policy does not mention is still a decision:
-- "not covered" is an answer, and the insurer needs it.
insert into policy_terms (case_id, policy_id, benefit_key, value, source, review_status, reviewed_by, reviewed_at)
select '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
       b.benefit_key, 'Not covered', 'manual', 'confirmed', fxid('rm'), now()
from benefit_catalogue b
where not exists (
  select 1 from policy_terms t
  where t.policy_id = '22222222-2222-2222-2222-222222222222'
    and t.benefit_key = b.benefit_key
);

select ok(
  app.policy_review_complete('22222222-2222-2222-2222-222222222222'),
  'With every benefit decided, the policy is ready for RFQ');

-- --------------------------------------------------------------------------
-- And an empty catalogue does not count as "everything decided" (0026).
--
-- Left last because it empties the catalogue, which nothing after it could
-- rely on. The transaction rolls back, so the rows return.
--
-- This is the same vacuous-truth fault as the blank policy above, one level
-- further out: 0020 made completeness mean "every benefit in the catalogue is
-- decided", which is trivially satisfied when there are no benefits. That is
-- the state of the database between `db:migrate` and `db:import-guardrails`,
-- and of any environment where the workbook import failed.
--
-- TRUNCATE CASCADE rather than DELETE: seven tables carry a foreign key to
-- benefit_key, and on a database where the workbook HAS been imported
-- sku_coverage alone holds eighty-odd thousand rows referencing it, so a plain
-- delete fails outright. Naming those seven here would make this assertion
-- break every time the schema gains an eighth — which is the same "depends on
-- the state of the database rather than on its own fixtures" fault this whole
-- suite is about. CASCADE follows the graph itself, and the rollback at the
-- end of the transaction puts every one of them back.
-- --------------------------------------------------------------------------
truncate benefit_catalogue cascade;

select is(
  (select count(*) from benefit_catalogue)::int, 0,
  'The catalogue can be emptied, so what follows is really testing that case');

select ok(
  not app.policy_review_complete('22222222-2222-2222-2222-222222222222'),
  'With no catalogue to measure against, the gate is shut rather than vacuously open');

select * from finish();
rollback;
