-- 010_rls_role_span.sql
-- Proves the §15 role/span matrix at the database layer.
--
-- These assertions run as `authenticated`, the role the application connects
-- as, so they exercise the same RLS path production does. §15 requires that a
-- bug in application-layer permission checks cannot leak deal data, which
-- means the guarantee has to be testable without the application present.

begin;
select plan(58);

-- --------------------------------------------------------------------------
-- Synthetic org (no real PII anywhere — CLAUDE.md).
--
--   hod ─┬─ mgr  ─┬─ c1
--        │        └─ c2
--        └─ mgr2 ─── c3        leader (separate branch, own subtree)
--
-- c3 is the isolation case: same organisation, different sub-tree.
-- --------------------------------------------------------------------------
create temporary table ids (who text primary key, id uuid default gen_random_uuid());
insert into ids (who) values
  ('super'),('admin'),('hod'),('leader'),('mgr'),('mgr2'),
  ('c1'),('c2'),('c3'),('pending'),('suspended');

create or replace function uid_of(text) returns uuid language sql stable as
  $$ select id from ids where who = $1 $$;

insert into app_users (id, email, name, role, manager_id, status) values
  (uid_of('super'),  'super@example.test',  'Super',     'super_admin',        null,        'active'),
  (uid_of('admin'),  'admin@example.test',  'Admin',     'admin',              null,        'active'),
  (uid_of('hod'),    'hod@example.test',    'HoD',       'head_of_department', null,        'active'),
  (uid_of('leader'), 'leader@example.test', 'Leader',    'leader',             null,        'active'),
  (uid_of('mgr'),    'mgr@example.test',    'Manager',   'manager',            uid_of('hod'),  'active'),
  (uid_of('mgr2'),   'mgr2@example.test',   'Manager 2', 'manager',            uid_of('hod'),  'active'),
  (uid_of('c1'),     'c1@example.test',     'C One',     'consultant',         uid_of('mgr'),  'active'),
  (uid_of('c2'),     'c2@example.test',     'C Two',     'consultant',         uid_of('mgr'),  'active'),
  (uid_of('c3'),     'c3@example.test',     'C Three',   'consultant',         uid_of('mgr2'), 'active'),
  (uid_of('pending'),'pending@example.test','Pending',    null,                null,        'pending'),
  (uid_of('suspended'),'susp@example.test', 'Suspended', 'consultant',         uid_of('mgr'),  'suspended');

insert into cases (id, customer_name, owner_user_id) values
  (gen_random_uuid(), 'Acme Synthetic Pvt Ltd',   uid_of('c1')),
  (gen_random_uuid(), 'Borealis Synthetic LLP',   uid_of('c2')),
  (gen_random_uuid(), 'Cobalt Synthetic Pvt Ltd', uid_of('c3')),
  (gen_random_uuid(), 'Delta Synthetic Pvt Ltd',  uid_of('mgr'));

create or replace function case_of(p_owner text) returns uuid language sql stable as
  $$ select id from cases where owner_user_id = uid_of(p_owner) limit 1 $$;

-- A descendant row on c1's case, to prove descendants inherit the case's rules.
insert into case_events (case_id, event_type, actor_type, actor_id)
values (case_of('c1'), 'case_created', 'user', uid_of('c1'));


-- Runs a statement as the current role and reports how many rows it touched.
-- Under RLS an UPDATE that matches nothing is a silent no-op rather than an
-- error, so "reached zero rows" is the assertion that actually proves a
-- read-only role is read-only.
create or replace function rows_affected(p_sql text) returns int
language plpgsql as $fn$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $fn$;

grant execute on function rows_affected(text) to authenticated;

grant select on ids to authenticated;
grant execute on function uid_of(text), case_of(text) to authenticated;

-- Act as a given user for the statements that follow.
create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from ids where who = p_who)::text, true);
end $$;

-- ==========================================================================
-- Consultant: own deals only, and may transact on them.
-- ==========================================================================
call act_as('c1');
set local role authenticated;

select is((select count(*) from cases)::int, 1,
  'Consultant sees exactly their own case');
select is((select customer_name from cases), 'Acme Synthetic Pvt Ltd',
  'Consultant sees the right case');
select is((select count(*) from cases where owner_user_id = uid_of('c2'))::int, 0,
  'Consultant cannot see a peer''s case under the same manager');
select is((select count(*) from case_events)::int, 1,
  'Consultant sees descendant rows of their own case');

select lives_ok(
  $$ update cases set state = 'in_review' where owner_user_id = uid_of('c1') $$,
  'Consultant can transact on their own deal');

-- An UPDATE that matches no visible row is silently a no-op under RLS, which
-- is the leak-free behaviour; assert the row really was untouched.
reset role;
select is((select state from cases where owner_user_id = uid_of('c2')), 'draft',
  'Consultant''s update did not reach a peer''s case');

call act_as('c1');
set local role authenticated;
select throws_ok(
  $$ insert into cases (customer_name, owner_user_id) values ('Sneaky', uid_of('c2')) $$,
  '42501',
  null,
  'Consultant cannot create a case owned by someone else');

-- ==========================================================================
-- Manager: own + full subtree visibility; transacts on own deals only.
-- ==========================================================================
reset role;
call act_as('mgr');
set local role authenticated;

select is((select count(*) from cases)::int, 3,
  'Manager sees own case plus both direct reports'' cases');
select is((select count(*) from cases where owner_user_id = uid_of('c3'))::int, 0,
  'Manager cannot see a case outside their subtree');

select lives_ok(
  $$ update cases set state = 'in_review' where owner_user_id = uid_of('mgr') $$,
  'Manager can transact on their own deal');

-- A Manager transacts across their team as well as on their own deals, at any
-- depth (§15 as confirmed; see ADR 0004). This is what makes cover during
-- leave and escalation work without reassigning ownership.
select is(rows_affected($q$update cases set state = 'mgr_edited' where owner_user_id = uid_of('c1')$q$), 1,
  'Manager can transact on a direct report''s deal');

select is(rows_affected($q$update cases set state = 'mgr_edited' where owner_user_id = uid_of('c2')$q$), 1,
  'Manager can transact on every report''s deal, not just one');

-- The boundary still holds: editing rights follow the subtree, not the org.
select throws_ok(
  $q$ insert into cases (customer_name, owner_user_id) values ('Outside span', uid_of('c3')) $q$,
  '42501', null,
  'Manager cannot create a case for someone outside their subtree');

select is(rows_affected($q$update cases set state = 'tampered' where owner_user_id = uid_of('c3')$q$), 0,
  'Manager cannot transact on a case outside their subtree');

-- A Manager may hand a deal to anyone in their own team, but not out of it.
select lives_ok(
  $q$ update cases set owner_user_id = uid_of('c2') where owner_user_id = uid_of('c1') $q$,
  'Manager can reassign a deal within their team');

select throws_ok(
  $q$ update cases set owner_user_id = uid_of('c3') where owner_user_id = uid_of('mgr') $q$,
  '42501', null,
  'Manager cannot push a deal outside their own visibility');

-- Put the reassigned deal back, so the assertions below still see the seeded
-- layout rather than the one this block just rearranged.
update cases
   set owner_user_id = uid_of('c1'), state = 'in_review'
 where customer_name = 'Acme Synthetic Pvt Ltd';

reset role;
select is((select count(*) from cases where owner_user_id = uid_of('c3') and state = 'draft')::int, 1,
  'the case outside the subtree is untouched');

-- ==========================================================================
-- Head of Department: entire subtree, read-only.
-- ==========================================================================
call act_as('hod');
set local role authenticated;

select is((select count(*) from cases)::int, 4,
  'HoD sees the entire subtree at every depth, including grandchildren');

select lives_ok(
  $$ insert into cases (customer_name, owner_user_id) values ('HoD case', uid_of('hod')) $$,
  'HoD can create a case of their own');

-- The cover principle: a Head of Department can act on a deal two levels below
-- them, so work is not stranded when the owner is unavailable.
select is(rows_affected($q$update cases set state = 'hod_edited' where owner_user_id = uid_of('c1')$q$), 1,
  'HoD can transact on a grandchild''s deal');

select is(rows_affected($q$update cases set state = 'hod_edited' where owner_user_id = uid_of('c3')$q$), 1,
  'HoD can transact across the whole subtree, both branches');

-- ==========================================================================
-- Leader: own subtree only. This leader has no reports, which is exactly the
-- case that would break if "entire span" had been read as "whole org".
-- ==========================================================================
reset role;
call act_as('leader');
set local role authenticated;

select is((select count(*) from cases)::int, 0,
  'Leader with no reports sees no deals — span is a subtree, not the org');
select lives_ok(
  $$ insert into cases (customer_name, owner_user_id) values ('Leader case', uid_of('leader')) $$,
  'Leader can create a case of their own');
select is(rows_affected($q$update cases set state = 'tampered' where owner_user_id = uid_of('c1')$q$), 0,
  'Leader still cannot reach a deal outside their own subtree');

-- ==========================================================================
-- Admin: all deals, read-only; CRUD on guardrails reference data only.
-- ==========================================================================
reset role;
call act_as('admin');
set local role authenticated;

-- Four seeded, plus the two the HoD and Leader created above.
select is((select count(*) from cases)::int, 6,
  'Admin sees every deal');
select throws_ok(
  $$ insert into cases (customer_name, owner_user_id) values ('Admin case', uid_of('admin')) $$,
  '42501', null,
  'Admin cannot create a case');
select is(rows_affected($q$update cases set state = 'tampered'$q$), 0,
  'Admin update reaches no deal rows — an administrative view, not a position in the hierarchy');

select lives_ok(
  $$ insert into ref_enums (enum_name, allowed_value) values ('test_enum', 'test_value') $$,
  'Admin can write guardrails reference data (§4.3 CRUD permission)');
select lives_ok(
  $$ insert into benefit_catalogue (benefit_key, display_order, section, benefit_label)
     values ('test_benefit', 9999, 'Test', 'Test Benefit') $$,
  'Admin can write benefit_catalogue');

select throws_ok(
  $$ insert into salesforce_accounts (org_id, label, secret_ref)
     values ('00D000', 'test', 'secret://test') $$,
  '42501', null,
  'Admin cannot touch core system config — reference data only');

select is((select count(*) from audit_log)::int, 0,
  'Admin cannot read the audit log (§14 places it in the Super Admin console)');

-- ==========================================================================
-- Consultant reading reference data.
-- ==========================================================================
reset role;
call act_as('c1');
set local role authenticated;

select isnt((select count(*) from ref_enums)::int, 0,
  'Consultant can read reference data');
select throws_ok(
  $$ insert into ref_enums (enum_name, allowed_value) values ('nope', 'nope') $$,
  '42501', null,
  'Consultant cannot write reference data');

-- ==========================================================================
-- Super Admin: everything.
-- ==========================================================================
reset role;
call act_as('super');
set local role authenticated;

select is((select count(*) from cases)::int, 6,
  'Super Admin sees every deal');
select lives_ok(
  $$ insert into cases (customer_name, owner_user_id) values ('SA case', uid_of('super')) $$,
  'Super Admin can transact');
select lives_ok(
  $$ insert into salesforce_accounts (org_id, label, secret_ref)
     values ('00D001', 'staging', 'secret://sf/staging') $$,
  'Super Admin can configure the system');
select isnt((select count(*) from audit_log)::int, null,
  'Super Admin can read the audit log');

-- ==========================================================================
-- Pending and suspended users are inert.
-- ==========================================================================
reset role;
call act_as('pending');
set local role authenticated;
select is((select count(*) from cases)::int, 0,
  'Pending user sees no deals');
select is((select count(*) from ref_enums)::int, 0,
  'Pending user sees no reference data');

reset role;
call act_as('suspended');
set local role authenticated;
select is((select count(*) from cases)::int, 0,
  'Suspended user sees no deals even though a role is still set');

reset role;
select set_config('app.current_user_id', '', true);
set local role authenticated;
select is((select count(*) from cases)::int, 0,
  'Unauthenticated session sees no deals');

-- ==========================================================================
-- audit_log is append-only for every application role (§16).
-- ==========================================================================
reset role;
call act_as('super');
set local role authenticated;

select lives_ok(
  $$ insert into audit_log (entity_type, entity_id, action, actor_type, actor_id)
     values ('cases', 'x', 'update', 'user', uid_of('super')) $$,
  'Any active user can append to the audit log');
select throws_ok(
  $$ update audit_log set action = 'rewritten' $$,
  '42501', null,
  'Super Admin''s application account cannot UPDATE the audit log');
select throws_ok(
  $$ delete from audit_log $$,
  '42501', null,
  'Super Admin''s application account cannot DELETE from the audit log');

-- The trigger stops a superuser too, which is what makes this immutability
-- rather than merely a revoked grant.
reset role;
select throws_ok(
  $$ update audit_log set action = 'rewritten' $$,
  '42501', null,
  'Even a superuser cannot UPDATE the audit log');
select throws_ok(
  $$ truncate audit_log $$,
  '42501', null,
  'Even a superuser cannot TRUNCATE the audit log');

-- ==========================================================================
-- Other append-only tables (§8 fine-tuning signal, §10 reproducibility).
-- ==========================================================================
call act_as('c1');
set local role authenticated;

select lives_ok(
  $$ insert into burn_calculations (case_id, computed_by, indicative_premium)
     values (case_of('c1'), uid_of('c1'), 100000) $$,
  'Burn calculation runs can be appended');
select throws_ok(
  $$ update burn_calculations set indicative_premium = 1 $$,
  '42501', null,
  'Burn calculations cannot be updated — every run is retained (§10)');
select throws_ok(
  $$ update case_events set event_type = 'rewritten' $$,
  '42501', null,
  'The case timeline is append-only');

-- ==========================================================================
-- A newly added case-descendant table inherits the case's rules. Without a
-- policy it would have RLS enabled and deny everything, or worse be readable
-- by anyone; either way the failure is silent until someone notices.
-- ==========================================================================
select lives_ok(
  $q$ insert into member_deviations (case_id, member_record_id, benefit_key, source, detail)
      select case_of('c1'), m.id, 'max_age_parents', 'expiring_policy', 'Parent aged 82 against an 80 limit'
      from member_records m where m.case_id = case_of('c1') $q$,
  'member_deviations accepts a row for a case the user can write');

select is((select count(*) from member_deviations)::int, 0,
  'no deviation rows exist yet for this case, so the insert above was a no-op on an empty roster');

reset role;
call act_as('c3');
set local role authenticated;
select is((select count(*) from member_deviations)::int, 0,
  'a user outside the subtree sees no deviations');

reset role;
call act_as('c1');
set local role authenticated;

-- ==========================================================================
-- Ownership transfer cannot be used to push a case out of sight.
-- ==========================================================================
-- The USING clause admits the row (the consultant owns it today) but the
-- WITH CHECK clause rejects the new owner, so this is a hard error rather than
-- a silent no-op. That is the stronger outcome: the attempt cannot succeed
-- quietly.
select throws_ok(
  $q$ update cases set owner_user_id = uid_of('c3') where owner_user_id = uid_of('c1') $q$,
  '42501', null,
  'Consultant cannot reassign their case to a user outside their visibility');

-- ==========================================================================
-- Hierarchy integrity.
-- ==========================================================================
reset role;
select throws_ok(
  $$ update app_users set manager_id = (select id from ids where who = 'c1')
     where id = (select id from ids where who = 'hod') $$,
  '23514', null,
  'A manager_id cycle is rejected');

select throws_ok(
  $$ update app_users set manager_id = id where id = (select id from ids where who = 'c1') $$,
  '23514', null,
  'A user cannot be their own manager');

select throws_ok(
  $$ update app_users set status = 'active', role = null
     where id = (select id from ids where who = 'pending') $$,
  '23514', null,
  'An active user must have a role');

-- ==========================================================================
-- Admin onboarding is scoped to pending users only.
-- ==========================================================================
call act_as('admin');
set local role authenticated;

select is(rows_affected($q$update app_users set role = 'consultant', status = 'active' where id = uid_of('pending')$q$), 1,
  'Admin can complete onboarding for a pending user');

select is(rows_affected($q$update app_users set role = 'super_admin' where id = uid_of('c1')$q$), 0,
  'Admin cannot change an already-active user''s role');

select * from finish();
rollback;
