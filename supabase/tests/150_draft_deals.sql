-- 150_draft_deals.sql
-- What may be thrown away, and what may not.
--
-- Picking a customer now creates the deal immediately, so the document slots
-- have something to attach to. The cost is a row for every abandoned search, so
-- the owner can discard one — but only while nobody has put anything into it.
-- Once there is a roster, claims, terms, a document or an RFQ, the deal is a
-- record of work and deleting it would take the audit trail with it (§16).

begin;
select plan(9);

create temporary table fx (who text primary key, id uuid default gen_random_uuid());
insert into fx (who) values ('rm'), ('other'), ('admin'), ('cust');
create or replace function fxid(text) returns uuid language sql stable as
  $$ select id from fx where who = $1 $$;

grant select on fx to authenticated;
grant execute on function fxid(text) to authenticated;

-- Identity is read from app.current_user_id (see 010), not from a JWT claim.
create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from fx where who = p_who)::text, true);
end $$;

insert into app_users (id, email, name, role, status) values
  (fxid('rm'),    'draft-rm@example.test',    'RM',    'consultant',  'active'),
  (fxid('other'), 'draft-other@example.test', 'Other', 'consultant',  'active'),
  (fxid('admin'), 'draft-admin@example.test', 'Admin', 'super_admin', 'active');

insert into customers (id, legal_name, gstin)
values (fxid('cust'), 'Draft Synthetic Pvt Ltd', '99AAECF1234N1Z5');

insert into cases (id, customer_id, owner_user_id) values
  ('eeee6666-0000-0000-0000-000000000001', fxid('cust'), fxid('rm')),
  ('eeee6666-0000-0000-0000-000000000002', fxid('cust'), fxid('rm'));

-- --------------------------------------------------------------------------
-- What counts as a draft.
-- --------------------------------------------------------------------------
select ok(
  app.case_is_draft('eeee6666-0000-0000-0000-000000000001'),
  'a deal nobody has put anything into is a draft'
);

insert into member_records (case_id, relationship, age)
values ('eeee6666-0000-0000-0000-000000000002', 'employee', 34);

select ok(
  not app.case_is_draft('eeee6666-0000-0000-0000-000000000002'),
  'a roster makes it a record of work'
);

-- Each of these on its own is enough. A deal with a document and nothing else
-- still holds a file somebody uploaded.
insert into case_documents (case_id, kind, file_name, file_ref, uploaded_by)
values ('eeee6666-0000-0000-0000-000000000001', 'policy_copy', 'p.pdf',
        'cases/eeee6666-0000-0000-0000-000000000001/policy_copy/p.pdf', fxid('rm'));

select ok(
  not app.case_is_draft('eeee6666-0000-0000-0000-000000000001'),
  'and so does a single uploaded document'
);

delete from case_documents where case_id = 'eeee6666-0000-0000-0000-000000000001';

select ok(
  app.case_is_draft('eeee6666-0000-0000-0000-000000000001'),
  'removing it makes the deal a draft again'
);

-- --------------------------------------------------------------------------
-- Who may act on that.
-- --------------------------------------------------------------------------
call act_as('rm');
set local role authenticated;

select lives_ok(
  $$ delete from cases where id = 'eeee6666-0000-0000-0000-000000000001' $$,
  'the owner can discard their own draft'
);

select is(
  (select count(*)::int from cases where id = 'eeee6666-0000-0000-0000-000000000001'),
  0,
  'and it is gone'
);

select lives_ok(
  $$ delete from cases where id = 'eeee6666-0000-0000-0000-000000000002' $$,
  'deleting a deal with a roster raises nothing — RLS filters rather than errors'
);

select is(
  (select count(*)::int from cases where id = 'eeee6666-0000-0000-0000-000000000002'),
  1,
  'but it is still there, which is what the app reports back as "this has work on it"'
);

-- Somebody else's draft is not theirs to throw away.
reset role;
insert into cases (id, customer_id, owner_user_id)
values ('eeee6666-0000-0000-0000-000000000003', fxid('cust'), fxid('rm'));

call act_as('other');
set local role authenticated;

select is(
  (select count(*)::int from cases where id = 'eeee6666-0000-0000-0000-000000000003'),
  0,
  'a deal outside your span is invisible, so there is nothing to discard'
);

select * from finish();
rollback;
