-- 030_rpc_surface.sql
-- Guards the boundary between the application and the database.
--
-- Every function the app calls through supabase.rpc() must exist in `public`
-- and be executable by `authenticated`. Functions in `app` are invisible to
-- PostgREST, so a call to one fails as if it did not exist — which is how the
-- first real sign-in failed, reported as "account not permitted" because the
-- callback could not tell a missing function from a rejected domain.
--
-- Equally important is the other direction: the internal helpers must NOT be
-- reachable. Exposing app.can_write_case or app.span_user_ids as callable HTTP
-- endpoints would hand the §15 model's internals to any signed-in user.

begin;
select plan(17);

-- --------------------------------------------------------------------------
-- Callable from the application.
-- --------------------------------------------------------------------------
select has_function('public', 'provision_signed_in_user', array['uuid', 'text', 'text'],
  'provision_signed_in_user is exposed in public, where supabase.rpc() looks');

select has_function('public', 'decide_access_request',
  array['uuid', 'boolean', 'text', 'uuid', 'text'],
  'decide_access_request is exposed in public');

select function_privs_are('public', 'provision_signed_in_user', array['uuid', 'text', 'text'],
  'authenticated', array['EXECUTE'],
  'authenticated may execute provision_signed_in_user');

select function_privs_are('public', 'decide_access_request',
  array['uuid', 'boolean', 'text', 'uuid', 'text'],
  'authenticated', array['EXECUTE'],
  'authenticated may execute decide_access_request');

-- Signatures must take plain types: the app.user_role enum and citext live in
-- unexposed schemas, so PostgREST cannot describe or cast to them.
select is(
  (select pg_get_function_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'provision_signed_in_user'),
  'p_user_id uuid, p_email text, p_name text',
  'provision_signed_in_user takes only types PostgREST can describe');

-- --------------------------------------------------------------------------
-- Not reachable from the application.
-- --------------------------------------------------------------------------
select hasnt_function('public', 'can_write_case', array['uuid'],
  'the §15 write check is not exposed as an HTTP endpoint');
select hasnt_function('public', 'span_user_ids',
  'the hierarchy walk is not exposed as an HTTP endpoint');
select hasnt_function('public', 'consume_bootstrap_super_admin', array['uuid', 'citext'],
  'the bootstrap grant cannot be consumed over HTTP');
select hasnt_function('public', 'case_owner', array['uuid'],
  'case ownership lookup is not exposed as an HTTP endpoint');

-- --------------------------------------------------------------------------
-- The wrappers must actually work, not merely exist. Exercised exactly as the
-- application calls them: as `authenticated`, with plain text arguments.
-- --------------------------------------------------------------------------
create temporary table rpc_ids (who text primary key, id uuid default gen_random_uuid());
insert into rpc_ids (who) values ('newbie'), ('approver'), ('mgr');
grant select on rpc_ids to authenticated;

-- Fixtures on a reserved TLD, allowed only inside this transaction, so they can
-- never collide with a real account's email. See the note in 020.
insert into allowed_email_domains (domain, note)
values ('example.test', 'Test fixtures only — reserved TLD, never a real address')
on conflict (domain) do nothing;

insert into app_users (id, email, name, role, status)
select id, who || '@example.test', initcap(who), 'admin'::app.user_role, 'active'
from rpc_ids where who = 'approver';
insert into app_users (id, email, name, role, status)
select id, who || '@example.test', initcap(who), 'manager'::app.user_role, 'active'
from rpc_ids where who = 'mgr';

set local role authenticated;

select is(
  (select p.status from public.provision_signed_in_user(
     (select id from rpc_ids where who = 'newbie'), 'newbie@example.test', 'New Bie') p),
  'pending',
  'public.provision_signed_in_user runs as authenticated and returns pending');

select throws_ok(
  format($q$ select public.provision_signed_in_user(%L, 'outsider@gmail.com', 'Outsider') $q$,
    gen_random_uuid()),
  '42501', null,
  'the wrapper still rejects a disallowed domain');

-- Act as the approver: access_requests is behind RLS, so an unidentified
-- session cannot even see the row it is meant to decide.
reset role;
select set_config('app.current_user_id', (select id from rpc_ids where who = 'approver')::text, true);
set local role authenticated;

select lives_ok(
  format($q$ select public.decide_access_request(
      (select id from access_requests where requested_by = %L), true, 'consultant', %L, null) $q$,
    (select id from rpc_ids where who = 'newbie'),
    (select id from rpc_ids where who = 'mgr')),
  'public.decide_access_request approves through the wrapper, with the role as text');

-- --------------------------------------------------------------------------
-- decide_user_access: the queue acts on a person, so a missing or already
-- resolved request row cannot strand them (0019).
-- --------------------------------------------------------------------------
select has_function('public', 'decide_user_access',
  array['uuid', 'boolean', 'text', 'uuid', 'text'],
  'decide_user_access is exposed where supabase.rpc() looks');

reset role;
insert into rpc_ids (who) values ('stranded');
insert into app_users (id, email, name, status)
select id, 'stranded@example.test', 'Stranded', 'pending' from rpc_ids where who = 'stranded';

-- Deliberately NO access_requests row: this is the state that used to make
-- someone invisible to the approvals screen.
select is(
  (select count(*) from access_requests where requested_by = (select id from rpc_ids where who = 'stranded'))::int,
  0,
  'the fixture has no request row, which is the state that used to strand a user');

select set_config('app.current_user_id', (select id from rpc_ids where who = 'approver')::text, true);
set local role authenticated;

select lives_ok(
  format($q$ select public.decide_user_access(%L, true, 'consultant', %L, null) $q$,
    (select id from rpc_ids where who = 'stranded'),
    (select id from rpc_ids where who = 'mgr')),
  'a pending user with no request row can still be approved');

reset role;
select results_eq(
  $$ select role::text, status::text from app_users
     where id = (select id from rpc_ids where who = 'stranded') $$,
  $$ select 'consultant', 'active' $$,
  'the approval took effect on the user, and a request row was written for the record');

select has_function('public', 'classify_term_change', array['text', 'text', 'text'],
  'classify_term_change is exposed where supabase.rpc() looks');

select * from finish();
rollback;
