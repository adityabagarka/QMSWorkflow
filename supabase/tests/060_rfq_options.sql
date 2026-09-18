-- 060_rfq_options.sql
-- Proposed options are differences from the expiring policy, not copies of it.

begin;
select plan(10);

create temporary table ox (who text primary key, id uuid default gen_random_uuid());
insert into ox (who) values ('rm'), ('cust');
create or replace function oxid(text) returns uuid language sql stable as
  $$ select id from ox where who = $1 $$;

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label) values
  ('members_covered', 1, 'The basics', 'Members Covered'),
  ('max_age_parents', 8, 'The basics', 'Max age - Parents'),
  ('maternity_cover', 39, 'Mother & Child', 'Maternity Cover')
on conflict (benefit_key) do nothing;

insert into app_users (id, email, name, role, status)
values (oxid('rm'), 'rm2@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name) values (oxid('cust'), 'Option Test Ltd');

insert into cases (id, customer_id, owner_user_id, cover_start_date)
values ('aaaa1111-0000-0000-0000-000000000001', oxid('cust'), oxid('rm'), '2026-11-01');

insert into policies (id, case_id) values
  ('bbbb1111-0000-0000-0000-000000000001', 'aaaa1111-0000-0000-0000-000000000001');

insert into policy_terms (case_id, policy_id, benefit_key, value, source, review_status, reviewed_by, reviewed_at) values
  ('aaaa1111-0000-0000-0000-000000000001','bbbb1111-0000-0000-0000-000000000001','members_covered','Employee, Spouse, Children, Parents','manual','confirmed',oxid('rm'),now()),
  ('aaaa1111-0000-0000-0000-000000000001','bbbb1111-0000-0000-0000-000000000001','max_age_parents','80 years','manual','confirmed',oxid('rm'),now()),
  ('aaaa1111-0000-0000-0000-000000000001','bbbb1111-0000-0000-0000-000000000001','maternity_cover','Rs 50,000','manual','confirmed',oxid('rm'),now());

insert into rfq_options (id, case_id, option_no, name, created_by) values
  ('cccc1111-0000-0000-0000-000000000001','aaaa1111-0000-0000-0000-000000000001',1,'Same as expiring',oxid('rm')),
  ('cccc1111-0000-0000-0000-000000000002','aaaa1111-0000-0000-0000-000000000001',2,'Enhanced maternity',oxid('rm'));

-- Option 2 changes one benefit. Option 1 changes nothing and stores nothing.
insert into rfq_option_terms (option_id, case_id, benefit_key, value)
values ('cccc1111-0000-0000-0000-000000000002','aaaa1111-0000-0000-0000-000000000001','maternity_cover','Rs 75,000');

-- --------------------------------------------------------------------------
select is(
  (select count(*) from rfq_option_terms where option_id = 'cccc1111-0000-0000-0000-000000000001')::int,
  0,
  'Option 1 stores nothing — it cannot drift from the expiring terms');

select is(
  (select count(*) from app.option_terms('cccc1111-0000-0000-0000-000000000001') where is_changed)::int,
  0,
  'Option 1 shows no changed cells');

select is(
  (select value from app.option_terms('cccc1111-0000-0000-0000-000000000001') where benefit_key = 'maternity_cover'),
  'Rs 50,000',
  'Option 1 reads through to the expiring value');

select is(
  (select count(*) from app.option_terms('cccc1111-0000-0000-0000-000000000002') where is_changed)::int,
  1,
  'Option 2 has exactly one changed cell');

select is(
  (select value from app.option_terms('cccc1111-0000-0000-0000-000000000002') where benefit_key = 'maternity_cover'),
  'Rs 75,000',
  'The changed benefit shows the option value');

select is(
  (select value from app.option_terms('cccc1111-0000-0000-0000-000000000002') where benefit_key = 'max_age_parents'),
  '80 years',
  'An unchanged benefit still reads through to expiring');

-- Every option covers the whole catalogue, so no column has holes the others
-- do not, and the insurer sees a complete set either way.
select is(
  (select count(*) from app.option_terms('cccc1111-0000-0000-0000-000000000002'))::int,
  (select count(*) from benefit_catalogue)::int,
  'An option spans every benefit in the catalogue');

-- --------------------------------------------------------------------------
-- Correcting an expiring term reaches the options that had not overridden it.
-- This is the reason for storing differences rather than copies.
-- --------------------------------------------------------------------------
update policy_terms set value = '85 years'
 where policy_id = 'bbbb1111-0000-0000-0000-000000000001' and benefit_key = 'max_age_parents';

select is(
  (select value from app.option_terms('cccc1111-0000-0000-0000-000000000002') where benefit_key = 'max_age_parents'),
  '85 years',
  'A corrected expiring term flows into options that had not changed it');

select is(
  (select value from app.option_terms('cccc1111-0000-0000-0000-000000000002') where benefit_key = 'maternity_cover'),
  'Rs 75,000',
  'but does not disturb a benefit the option had overridden');

-- Options are named by hand, because a generated name stops describing an
-- option once several terms move.
select lives_ok(
  $$ update rfq_options set name = 'Enhanced maternity, parents to 85'
     where option_no = 2 and case_id = 'aaaa1111-0000-0000-0000-000000000001' $$,
  'An option can be renamed');

select * from finish();
rollback;
