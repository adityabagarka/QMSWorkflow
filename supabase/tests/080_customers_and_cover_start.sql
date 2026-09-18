-- 080_customers_and_cover_start.sql
-- A customer is an entity (migration 0027), and a shifted cover start says why.
--
-- The visibility assertions are the ones that matter. Customers are readable by
-- every active user, which is a deliberate departure from the span model that
-- governs cases (§15) — so this suite has to prove that the departure is
-- exactly as wide as intended and no wider: the company is visible, the deal
-- is not.

begin;
select plan(23);

create temporary table cx (who text primary key, id uuid default gen_random_uuid());
insert into cx (who) values ('mgr'), ('rm'), ('outsider'), ('super'), ('cust_a'), ('cust_b');
create or replace function cxid(text) returns uuid language sql stable as
  $$ select id from cx where who = $1 $$;

-- Same idiom as 010: identity comes from the app.current_user_id setting, and
-- the fixture table has to be readable once the role switches.
grant select on cx to authenticated;
grant execute on function cxid(text) to authenticated;

create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from cx where who = p_who)::text, true);
end $$;

insert into app_users (id, email, name, role, manager_id, status) values
  (cxid('super'),    'cust-super@example.test',    'Super',    'super_admin', null,          'active'),
  (cxid('mgr'),      'cust-mgr@example.test',      'Manager',  'manager',     null,          'active'),
  (cxid('rm'),       'cust-rm@example.test',       'RM',       'consultant',  cxid('mgr'),   'active'),
  -- Under a different manager, so nothing of the RM's is in their span.
  (cxid('outsider'), 'cust-outsider@example.test', 'Outsider', 'consultant',  cxid('super'), 'active');

insert into customers (id, gstin, legal_name, entity_type, industry, location) values
  (cxid('cust_a'), '27AABCM1234N1Z5', 'Meridian Synthetic Pvt Ltd', 'Pvt Ltd', 'Transport & Logistics', 'Pune'),
  (cxid('cust_b'), null,              'Quotehub Synthetic Pvt Ltd', 'Pvt Ltd', 'Gems & Jewellery',      'Mumbai');

insert into cases (id, customer_id, owner_user_id, policy_expiry_date, cover_start_date, cover_start_derived_date)
values ('dddd0000-0000-0000-0000-000000000001', cxid('cust_a'), cxid('rm'), '2026-10-31', '2026-11-01', '2026-11-01');

-- --------------------------------------------------------------------------
-- The company is an entity, and the deal points at it.
-- --------------------------------------------------------------------------
select is(
  (select c.legal_name from cases k join customers c on c.id = k.customer_id
    where k.id = 'dddd0000-0000-0000-0000-000000000001'),
  'Meridian Synthetic Pvt Ltd',
  'A case reads its company through the customer');

select throws_ok(
  $$ insert into cases (customer_id, owner_user_id) values (null, cxid('rm')) $$,
  '23502', null,
  'A case cannot exist without a customer');

-- One company, many deals: the whole point of the table, and the thing the
-- renewal flow depends on.
insert into cases (id, customer_id, owner_user_id)
values ('dddd0000-0000-0000-0000-000000000002', cxid('cust_a'), cxid('rm'));

select is(
  (select count(*) from cases where customer_id = cxid('cust_a'))::int, 2,
  'One customer carries more than one deal');

select throws_ok(
  $$ insert into customers (legal_name, gstin) values ('Impostor Ltd', '27AABCM1234N1Z5') $$,
  '23505', null,
  'Two customers cannot share a GSTIN — that is what stops the same company being created twice');

select throws_ok(
  $$ insert into customers (legal_name, gstin) values ('Lowercase Ltd', '27aabcx0000x1z9') $$,
  '23514', null,
  'A GSTIN is stored as printed, so a lowercase one cannot slip past the uniqueness check');

select lives_ok(
  $$ insert into customers (legal_name) values ('No GSTIN Yet Ltd') $$,
  'A customer can exist before its GSTIN is known — a deal often starts from a phone call');

select throws_ok(
  $$ insert into customers (legal_name) values ('   ') $$,
  '23514', null,
  'A customer must be named');

-- Pasting a GSTIN into the name field is an easy mistake, and it ends up
-- printed on a policy. It happened on the first real deal created through
-- this app, which is why it is a constraint rather than a validation.
select throws_ok(
  $$ insert into customers (legal_name) values ('27AABCM9999N1Z5') $$,
  '23514', null,
  'A GSTIN is not a company name, whatever was typed');

select lives_ok(
  $$ insert into customers (legal_name, brand_name) values ('Brandful Synthetic Pvt Ltd', 'Brandful') $$,
  'A customer carries both the name people use and the name on the paperwork');

select throws_ok(
  $$ delete from customers where id = cxid('cust_a') $$,
  '23503', null,
  'A customer with deals against it cannot be deleted');

-- --------------------------------------------------------------------------
-- Cover start: derived, overridable, explained.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ update cases set cover_start_date = '2026-12-01'
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'Moving inception away from the day after expiry is refused without a reason');

select lives_ok(
  $$ update cases set cover_start_date = '2026-12-01', cover_start_change_reason = 'gap_accepted'
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  'With a reason, the shift is accepted');

select throws_ok(
  $$ update cases set cover_start_change_reason = 'client_was_busy'
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'The reason comes from a fixed vocabulary, so it can be counted across deals');

select throws_ok(
  $$ update cases set cover_start_change_reason = 'other', cover_start_change_note = null
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  '23514', null,
  '"other" with no note is refused — it looks answered and says nothing');

select lives_ok(
  $$ update cases set cover_start_change_reason = 'other',
                      cover_start_change_note = 'Insurer could not issue in time'
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  '"other" is allowed once the note carries it');

select lives_ok(
  $$ update cases
        set cover_start_date = cover_start_derived_date,
            cover_start_change_reason = null,
            cover_start_change_note = null
      where id = 'dddd0000-0000-0000-0000-000000000001' $$,
  'Putting inception back needs no reason');

-- --------------------------------------------------------------------------
-- Visibility: the company is shared, the deal is not.
-- --------------------------------------------------------------------------
-- The outsider is under a different manager, so none of the RM's deals are in
-- their span.
call act_as('outsider');
set local role authenticated;

select is(
  (select count(*) from customers where id in (cxid('cust_a'), cxid('cust_b')))::int, 2,
  'An active user sees every customer, including companies whose deals are not theirs');

select is(
  (select count(*) from cases where customer_id = cxid('cust_a'))::int, 0,
  'but sees none of that customer''s deals — the span model still governs those');

select lives_ok(
  $$ insert into customers (legal_name) values ('Created By Outsider Ltd') $$,
  'Any active user may create a customer');

select lives_ok(
  $$ update customers set location = 'Chennai' where id = cxid('cust_b') $$,
  'and may correct one, since the details are public registry data');

select is(
  (select count(*) from customers where id = cxid('cust_b') and location = 'Chennai')::int, 1,
  'the correction took effect');

-- Deleting is reserved: a genuine duplicate created before anyone quoted
-- against it is the only case for it, and that is a Super Admin's call.
select is(
  (select count(*) from customers where legal_name = 'Created By Outsider Ltd')::int, 1,
  'the customer exists before the delete is attempted');

delete from customers where legal_name = 'Created By Outsider Ltd';

select is(
  (select count(*) from customers where legal_name = 'Created By Outsider Ltd')::int, 1,
  'a consultant cannot delete a customer — RLS silently removes the row from the delete''s scope');

reset role;

select * from finish();
rollback;
