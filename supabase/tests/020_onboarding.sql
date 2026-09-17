-- 020_onboarding.sql
-- Proves the §15 onboarding flow: new user -> pending -> Admin approves with
-- role and manager assignment.

begin;
select plan(25);

create temporary table t (who text primary key, id uuid default gen_random_uuid());
insert into t (who) values ('admin'),('super'),('mgr'),('newbie'),('outsider'),('boot');

create or replace function tuid(text) returns uuid language sql stable as
  $$ select id from t where who = $1 $$;

-- Fixtures live on a reserved TLD that can never be a real address, and the
-- domain is allowed only inside this transaction.
--
-- This suite previously used @plumhq.com fixtures and the real seeded bootstrap
-- address. That held until someone actually signed in, at which point the test
-- collided with a live account and the deploy failed — on a correct refusal by
-- the code. A test that reads production data is not testing anything
-- repeatable.
insert into allowed_email_domains (domain, note)
values ('example.test', 'Test fixtures only — reserved TLD, never a real address')
on conflict (domain) do nothing;

grant select on t to authenticated;
grant execute on function tuid(text) to authenticated;

insert into app_users (id, email, name, role, status) values
  (tuid('admin'), 'admin@example.test', 'Admin', 'admin',       'active'),
  (tuid('super'), 'super@example.test', 'Super', 'super_admin', 'active'),
  (tuid('mgr'),   'mgr@example.test',   'Mgr',   'manager',     'active');

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
  (select status::text from app.provision_signed_in_user(tuid('newbie'), 'newbie@example.test', 'New Bie')),
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
  format($q$ select app.provision_signed_in_user(%L, 'newbie@example.test', 'New Bie') $q$, tuid('newbie')),
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
insert into bootstrap_super_admins (email) values ('boot@example.test');

select is(
  (select role::text from app.provision_signed_in_user(tuid('boot'), 'boot@example.test', 'Boot Strap')),
  'super_admin',
  'A pending bootstrap grant makes the signer an active Super Admin on first sign-in');

select is((select count(*) from bootstrap_super_admins where email = 'boot@example.test' and consumed_at is not null)::int, 1,
  'The bootstrap grant is consumed exactly once');

-- The guarantee that fired for real during deploy #4: an email already tied to
-- an account cannot be claimed by a second sign-in identity. Asserting it turns
-- that incident into a permanent check.
select throws_ok(
  format($q$ select app.provision_signed_in_user(%L, 'boot@example.test', 'Impostor') $q$,
    gen_random_uuid()),
  '23505', null,
  'A different sign-in identity cannot claim an email that already has an account');

-- --------------------------------------------------------------------------
-- The lockout fixed in migration 0018.
--
-- Provisioning raises an access request, and the bootstrap grant then answers
-- it. Leaving it pending put the new Super Admin's own request in front of them
-- on their first screen, where approving it demoted them out of the role the
-- grant had just given — and, if the chosen role was not an approver, took the
-- approvals screen with it. One Super Admin, invited to stop being one.
-- --------------------------------------------------------------------------
select is(
  (select count(*) from access_requests
    where requested_by = tuid('boot') and status = 'pending')::int,
  0,
  'Consuming a bootstrap grant leaves no pending request behind');

select is(
  (select status::text from access_requests where requested_by = tuid('boot')),
  'approved',
  'The bootstrap grant is recorded as the decision on that request');

select ok(
  (select decision_note from access_requests where requested_by = tuid('boot')) like '%bootstrap%',
  'The note says it was a bootstrap, so it is not mistaken for a real self-approval');

-- Belt and braces: even reachable, a self-decision is refused outright.
select set_config('app.current_user_id', tuid('boot')::text, true);
set local role authenticated;

select throws_ok(
  format($q$ select app.decide_access_request(%L, true, 'consultant', %L, null) $q$,
    (select id from access_requests where requested_by = tuid('boot')), tuid('mgr')),
  '42501', null,
  'Nobody may decide their own access request, whatever their role');

reset role;

select * from finish();
rollback;
