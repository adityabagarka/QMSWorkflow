-- 100_claims_reconciliation.sql
-- The gate that stops an RFQ going out on figures nobody chose (ADR 0011 §5).
--
-- The insurer's MIS and their own claims dump are two accounts of one history.
-- Where they differ the system must not pick: it holds the RFQ until a person
-- does, and records what they chose and why — because a gap between what an
-- insurer reports and what their data shows is a negotiating position, and a
-- silent default would throw it away.

begin;
select plan(18);

create temporary table rx (who text primary key, id uuid default gen_random_uuid());
insert into rx (who) values ('rm'), ('other'), ('cust');
create or replace function rxid(text) returns uuid language sql stable as
  $$ select id from rx where who = $1 $$;

insert into app_users (id, email, name, role, status) values
  (rxid('rm'),    'rec-rm@example.test',    'RM',    'consultant', 'active'),
  (rxid('other'), 'rec-other@example.test', 'Other', 'consultant', 'active');

insert into customers (id, legal_name) values (rxid('cust'), 'Reconcile Synthetic Pvt Ltd');

insert into cases (id, customer_id, owner_user_id)
values ('ffff0000-0000-0000-0000-000000000001', rxid('cust'), rxid('rm'));

-- --------------------------------------------------------------------------
-- Nothing to choose is reconciled, which is correct rather than lenient.
-- --------------------------------------------------------------------------
select ok(
  app.claims_reconciled('ffff0000-0000-0000-0000-000000000001'),
  'A case with no disagreements is reconciled — there is nothing to decide');

-- --------------------------------------------------------------------------
-- A disagreement holds the RFQ until somebody settles it.
-- --------------------------------------------------------------------------
insert into claims_reconciliations (case_id, metric, stated_value, computed_value)
values ('ffff0000-0000-0000-0000-000000000001', 'amount_outstanding', 310000, 250000);

select ok(
  not app.claims_reconciled('ffff0000-0000-0000-0000-000000000001'),
  'An undecided disagreement holds the gate shut');

select is(
  (select count(*) from app.claims_unreconciled('ffff0000-0000-0000-0000-000000000001'))::int, 1,
  'and the gate names which figure is outstanding');

select is(
  (select stated from app.claims_unreconciled('ffff0000-0000-0000-0000-000000000001')), 310000::numeric,
  'both figures are carried, not just the fact of a gap');

-- --------------------------------------------------------------------------
-- A decision must be attributable and must carry a figure.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update claims_reconciliations set chosen = 'stated', chosen_value = 310000 $$,
  '23514', null,
  'A choice with no decider is refused — this is evidence, not a flag');

select throws_ok(
  format($q$ update claims_reconciliations
                set chosen = 'stated', decided_by = %L, decided_at = now() $q$, rxid('rm')),
  '23514', null,
  'and a choice that does not say which figure goes forward is refused too');

select throws_ok(
  format($q$ update claims_reconciliations
                set chosen = 'whichever', chosen_value = 1, decided_by = %L, decided_at = now() $q$,
         rxid('rm')),
  '23514', null,
  'The choice comes from a fixed vocabulary');

-- --------------------------------------------------------------------------
-- "Neither" is allowed, and costs more to say.
-- --------------------------------------------------------------------------
select throws_ok(
  format($q$ update claims_reconciliations
                set chosen = 'neither', chosen_value = 275000, decided_by = %L, decided_at = now() $q$,
         rxid('rm')),
  '23514', null,
  'Rejecting both figures without saying why is refused');

select throws_ok(
  format($q$ update claims_reconciliations
                set chosen = 'neither', chosen_value = null, note = 'Insurer double counted',
                    decided_by = %L, decided_at = now() $q$, rxid('rm')),
  '23514', null,
  'and so is rejecting both without naming the figure being quoted on');

select lives_ok(
  format($q$ update claims_reconciliations
                set chosen = 'neither', chosen_value = 275000,
                    note = 'Insurer counted two claims twice; agreed on a call.',
                    decided_by = %L, decided_at = now() $q$, rxid('rm')),
  'With a figure and a reason, neither is a legitimate answer');

select ok(
  app.claims_reconciled('ffff0000-0000-0000-0000-000000000001'),
  'and the gate opens');

-- --------------------------------------------------------------------------
-- The ordinary answers.
-- --------------------------------------------------------------------------
select lives_ok(
  format($q$ update claims_reconciliations
                set chosen = 'computed', chosen_value = computed_value, note = null,
                    decided_by = %L, decided_at = now() $q$, rxid('rm')),
  'Choosing our own computation needs no explanation');

select is(
  (select chosen_value from claims_reconciliations), 250000::numeric,
  'and the figure that goes forward is recorded, not recomputed later');

-- --------------------------------------------------------------------------
-- The RFQ gate answers for this blocker specifically.
--
-- Only this one. The full blocker list belongs to 110_rfq_gate, and asserting
-- it here as well would mean every future blocker breaks two suites — which is
-- exactly what happened when 0031 added terms, member data and options to it.
-- --------------------------------------------------------------------------
select ok(
  not ('claims_reconciliation' = any(app.rfq_blockers('ffff0000-0000-0000-0000-000000000001'))),
  'With the disagreement settled, claims are not among the reasons the RFQ is held');

update claims_reconciliations
   set chosen = null, chosen_value = null, decided_by = null, decided_at = null, note = null;

select ok(
  'claims_reconciliation' = any(app.rfq_blockers('ffff0000-0000-0000-0000-000000000001')),
  'Reopening it puts claims back among them');

select ok(
  not app.claims_reconciled('ffff0000-0000-0000-0000-000000000001'),
  'which is the same answer the gate function gives on its own');

-- --------------------------------------------------------------------------
-- A reconciliation is as private as its deal.
-- --------------------------------------------------------------------------
grant select on rx to authenticated;
grant execute on function rxid(text) to authenticated;

create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from rx where who = p_who)::text, true);
end $$;

call act_as('rm');
set local role authenticated;

select is(
  (select count(*) from claims_reconciliations
    where case_id = 'ffff0000-0000-0000-0000-000000000001')::int, 1,
  'The owner sees the disagreement on their deal');

reset role;
call act_as('other');
set local role authenticated;

select is(
  (select count(*) from claims_reconciliations
    where case_id = 'ffff0000-0000-0000-0000-000000000001')::int, 0,
  'Somebody outside the span sees none of it');

reset role;

select * from finish();
rollback;
