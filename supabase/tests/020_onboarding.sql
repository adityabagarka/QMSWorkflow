-- 020_onboarding.sql
-- Proves the §15 onboarding flow: new user -> pending -> Admin approves with
-- role and manager assignment.

begin;
select plan(20);

create temporary table t (who text primary key, id uuid default gen_random_uuid());
insert into t (who) values ('admin'),('super'),('mgr'),('newbie'),('outsider'),('boot');

create or replace function tuid(text) returns uuid language sql stable as
  $$ select id from t where who = $1 $$;

grant select on t to authenticated;
grant execute on function tuid(text) to authenticated;

insert into app_users (id, email, name, role, status) values
  (tuid('admin'), 'admin@plumhq.com', 'Admin', 'admin',       'active'),
  (tuid('super'), 'super@plumhq.com', 'Super', 'super_admin', 'active'),
  (tuid('mgr'),   'mgr@plumhq.com',   'Mgr',   'manager',     'active');

-- --------------------------------------------------------------------------
-- Domain allowlist: everything outside it is rejected outright.
-- --------------------------------------------------------------------------
select ok(app.is_allowed_email_domain('someone@plumhq.com'),
  'A Workspace address is allowed');
select ok(not app.is_allowed_email_domain('someone@gmail.com'),
  'An outside address is not allowed');

select throws_ok(
  format($q$ select app.provision_signed_in_user(%L, 'attacker@gmail.com', 'Attacker') $q$, tuid('outsider')),
  '42501', null,
  'Provisioning is refused for a disallowed domain');

select is((select count(*) from app_users where email = 'attacker@gmail.com')::int, 0,
  'No row is created for a rejected domain');

-- --------------------------------------------------------------------------
-- First sign-in creates a pending user and a pending request.
-- --------------------------------------------------------------------------
select is(
  (select status::text from app.provision_signed_in_user(tuid('newbie'), 'newbie@plumhq.com', 'New Bie')),
  'pending',
  'First sign-in lands the user at pending');

select is((select status::text from app_users where id = tuid('newbie')), 'pending',
  'The user row exists at pending');
select is((select role::text from app_users where id = tuid('newbie')), null,
  'A pending user holds no role');
select is((select count(*) from access_requests where requested_by = tuid('newbie') and status = 'pending')::int, 1,
  'A pending access request is queued');
select is((select count(*) from audit_log where entity_id = tuid('newbie')::text and action = 'user_provisioned')::int, 1,
  'Provisioning is recorded in the audit log');

-- Signing in again must not queue a second request.
select lives_ok(
  format($q$ select app.provision_signed_in_user(%L, 'newbie@plumhq.com', 'New Bie') $q$, tuid('newbie')),
  'Signing in again is idempotent');
select is((select count(*) from access_requests where requested_by = tuid('newbie'))::int, 1,
  'Repeat sign-in does not queue a duplicate request');

-- --------------------------------------------------------------------------
-- Approval assigns role and manager together (§15).
-- --------------------------------------------------------------------------
select set_config('app.current_user_id', tuid('admin')::text, true);
set local role authenticated;

select throws_ok(
  format($q$ select app.decide_access_request(%L, true, null, null, null) $q$,
    (select id from access_requests where requested_by = tuid('newbie'))),
  '22023', null,
  'Approving without a role is refused');

select throws_ok(
  format($q$ select app.decide_access_request(%L, true, 'consultant', null, null) $q$,
    (select id from access_requests where requested_by = tuid('newbie'))),
  '22023', null,
  'Approving a consultant without a manager is refused — span would be uncomputable');

select throws_ok(
  format($q$ select app.decide_access_request(%L, true, 'super_admin', null, null) $q$,
    (select id from access_requests where requested_by = tuid('newbie'))),
  '42501', null,
  'An Admin cannot grant the Super Admin role');

select lives_ok(
  format($q$ select app.decide_access_request(%L, true, 'consultant', %L, 'Joining the SME pod') $q$,
    (select id from access_requests where requested_by = tuid('newbie')), tuid('mgr')),
  'An Admin can approve with a role and a manager');

reset role;
select results_eq(
  $$ select role::text, status::text, manager_id from app_users where id = tuid('newbie') $$,
  $$ select 'consultant', 'active', tuid('mgr') $$,
  'The approved user is active, with the assigned role and manager');

select is((select count(*) from audit_log where entity_id = tuid('newbie')::text
             and action = 'access_request_approved')::int, 1,
  'The approval is recorded in the audit log');

-- A decided request cannot be decided twice.
select set_config('app.current_user_id', tuid('admin')::text, true);
set local role authenticated;
select throws_ok(
  format($q$ select app.decide_access_request(%L, true, 'manager', %L, null) $q$,
    (select id from access_requests where requested_by = tuid('newbie')), tuid('mgr')),
  '22023', null,
  'An already-decided request cannot be decided again');

-- --------------------------------------------------------------------------
-- Bootstrap Super Admin (ADR 0002).
-- --------------------------------------------------------------------------
reset role;
select is(
  (select role::text from app.provision_signed_in_user(tuid('boot'), 'aditya@bagarka.in', 'Aditya')),
  'super_admin',
  'The seeded bootstrap address becomes an active Super Admin on first sign-in');

select is((select count(*) from bootstrap_super_admins where email = 'aditya@bagarka.in' and consumed_at is not null)::int, 1,
  'The bootstrap grant is consumed exactly once');

select * from finish();
rollback;
