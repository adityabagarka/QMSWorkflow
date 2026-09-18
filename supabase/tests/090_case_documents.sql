-- 090_case_documents.sql
-- The documents a deal is built from, and the gate that requires them (0028).
--
-- The asymmetry is the thing under test: optional everywhere, required to
-- dispatch. A gate that refused at intake would block every deal on whichever
-- document the insurer is slowest to release; one that never refused would let
-- an RFQ go out on a programme whose member data nobody had seen.

begin;
select plan(17);

create temporary table dx (who text primary key, id uuid default gen_random_uuid());
insert into dx (who) values ('rm'), ('outsider'), ('cust');
create or replace function dxid(text) returns uuid language sql stable as
  $$ select id from dx where who = $1 $$;

grant select on dx to authenticated;
grant execute on function dxid(text) to authenticated;

create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from dx where who = p_who)::text, true);
end $$;

insert into app_users (id, email, name, role, status) values
  (dxid('rm'),       'doc-rm@example.test',       'RM',       'consultant', 'active'),
  (dxid('outsider'), 'doc-outsider@example.test', 'Outsider', 'consultant', 'active');

insert into customers (id, legal_name) values (dxid('cust'), 'Document Synthetic Pvt Ltd');

insert into cases (id, customer_id, owner_user_id)
values ('eeee0000-0000-0000-0000-000000000001', dxid('cust'), dxid('rm'));

-- --------------------------------------------------------------------------
-- Nothing is required to start.
-- --------------------------------------------------------------------------
select is(
  cardinality(app.case_documents_missing('eeee0000-0000-0000-0000-000000000001')), 4,
  'A new deal is missing all four documents');

select ok(
  not app.case_documents_complete('eeee0000-0000-0000-0000-000000000001'),
  'and is therefore not ready to dispatch an RFQ');

select is(
  app.case_documents_missing('eeee0000-0000-0000-0000-000000000001'),
  array['policy_copy', 'member_data', 'claims_dump', 'claims_mis'],
  'The gate names what is missing, in the order they are asked for');

-- --------------------------------------------------------------------------
-- They arrive one at a time, which is the normal case.
-- --------------------------------------------------------------------------
insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by)
values ('eeee0000-0000-0000-0000-000000000001', 'policy_copy',
        'cases/eeee0000-0000-0000-0000-000000000001/policy_copy/1-policy.pdf',
        'policy.pdf', dxid('rm'));

select is(
  app.case_documents_missing('eeee0000-0000-0000-0000-000000000001'),
  array['member_data', 'claims_dump', 'claims_mis'],
  'A document arriving removes it from the outstanding list and nothing else');

select throws_ok(
  $$ insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by)
     values ('eeee0000-0000-0000-0000-000000000001', 'policy_copy', 'x', 'again.pdf', dxid('rm')) $$,
  '23505', null,
  'A deal cannot hold two current policy copies — re-uploading replaces');

select lives_ok(
  $$ insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by)
     values ('eeee0000-0000-0000-0000-000000000001', 'other', 'y', 'email-thread.pdf', dxid('rm')),
            ('eeee0000-0000-0000-0000-000000000001', 'other', 'z', 'broker-note.pdf', dxid('rm')) $$,
  'but any number of supporting documents');

select throws_ok(
  $$ insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by)
     values ('eeee0000-0000-0000-0000-000000000001', 'random_thing', 'q', 'q.pdf', dxid('rm')) $$,
  '23514', null,
  'A document has to be one of the known kinds, since the gate counts them');

-- --------------------------------------------------------------------------
-- Reading state is recorded, not inferred.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update case_documents set read_state = 'failed', read_error = null
      where kind = 'policy_copy' $$,
  '23514', null,
  'A failed read must say why — "failed" on its own is not a diagnosis');

select lives_ok(
  $$ update case_documents set read_state = 'failed', read_error = 'Scanned image, no text layer'
      where kind = 'policy_copy' $$,
  'With a reason, the failure is recorded');

select lives_ok(
  $$ update case_documents set read_state = 'empty', read_error = null
      where kind = 'policy_copy' $$,
  'A file that was read and yielded nothing is distinguishable from one nobody has read');

-- --------------------------------------------------------------------------
-- The gate opens only when all four are held.
-- --------------------------------------------------------------------------
insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by) values
  ('eeee0000-0000-0000-0000-000000000001', 'member_data', 'a', 'roster.xlsx',  dxid('rm')),
  ('eeee0000-0000-0000-0000-000000000001', 'claims_dump', 'b', 'claims.xlsx',  dxid('rm'));

select ok(
  not app.case_documents_complete('eeee0000-0000-0000-0000-000000000001'),
  'Three of four still holds the gate shut');

insert into case_documents (case_id, kind, file_ref, file_name, uploaded_by)
values ('eeee0000-0000-0000-0000-000000000001', 'claims_mis', 'c', 'mis.pdf', dxid('rm'));

select ok(
  app.case_documents_complete('eeee0000-0000-0000-0000-000000000001'),
  'With all four held, the documents no longer block dispatch');

-- A supporting document is not one of the four, so it cannot stand in for one.
select is(
  cardinality(app.case_documents_missing('eeee0000-0000-0000-0000-000000000001')), 0,
  'and nothing is outstanding');

-- --------------------------------------------------------------------------
-- Documents inherit the case's permissions.
-- --------------------------------------------------------------------------
call act_as('rm');
set local role authenticated;

select is(
  (select count(*) from case_documents
    where case_id = 'eeee0000-0000-0000-0000-000000000001')::int, 6,
  'The owner sees every document on their deal');

reset role;
call act_as('outsider');
set local role authenticated;

select is(
  (select count(*) from case_documents
    where case_id = 'eeee0000-0000-0000-0000-000000000001')::int, 0,
  'Somebody outside the span sees none of them — a document is as private as its deal');

select lives_ok(
  $$ delete from case_documents where case_id = 'eeee0000-0000-0000-0000-000000000001' $$,
  'and a delete they are not entitled to make simply matches nothing');

reset role;

select is(
  (select count(*) from case_documents
    where case_id = 'eeee0000-0000-0000-0000-000000000001')::int, 6,
  'so the documents are still there');

select * from finish();
rollback;
