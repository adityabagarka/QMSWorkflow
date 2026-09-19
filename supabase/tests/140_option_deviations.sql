-- 140_option_deviations.sql
-- A deviation belongs to the option that causes it.
--
-- 0015 allowed one RFQ-side deviation per member per term, which is right until
-- an RFQ carries options — and options deviating differently is the entire
-- point of having them. Option 2 lowering the parent ceiling to 70 puts a
-- different set of lives outside the terms than Option 3 dropping parents.
-- Without per-option scoping the second option checked would overwrite the
-- first, and the screen would show one option's exclusions against another
-- option's terms.

begin;
select plan(11);

create temporary table dx (who text primary key, id uuid default gen_random_uuid());
insert into dx (who) values ('rm'), ('cust');
create or replace function dxid(text) returns uuid language sql stable as
  $$ select id from dx where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (dxid('rm'), 'deviations-rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name, gstin)
values (dxid('cust'), 'Deviation Synthetic Pvt Ltd', '99AAECD1234N1Z5');

insert into cases (id, customer_id, owner_user_id)
values ('dddd5555-0000-0000-0000-000000000001', dxid('cust'), dxid('rm'));

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label)
values ('dev_max_age_parents', 9201, 'The basics', 'Dev Max Age Parents')
on conflict (benefit_key) do nothing;

insert into member_records (id, case_id, relationship, age)
values ('dddd5555-0000-0000-0000-00000000000a', 'dddd5555-0000-0000-0000-000000000001', 'parent', 74);

insert into rfq_options (id, case_id, option_no, name, created_by) values
  ('dddd5555-0000-0000-0000-000000000011', 'dddd5555-0000-0000-0000-000000000001', 1, 'Same as expiring', dxid('rm')),
  ('dddd5555-0000-0000-0000-000000000012', 'dddd5555-0000-0000-0000-000000000001', 2, 'Parents to 70', dxid('rm'));

-- --------------------------------------------------------------------------
-- The same life, outside two options, twice.
-- --------------------------------------------------------------------------
select lives_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, option_id, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'rfq', 'dddd5555-0000-0000-0000-000000000011',
             '75 years', '74 years', 'Outside option 1.') $$,
  'a life can fall outside one option'
);

select lives_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, option_id, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'rfq', 'dddd5555-0000-0000-0000-000000000012',
             '70 years', '74 years', 'Outside option 2.') $$,
  'and the same life outside another option is a second finding, not an overwrite'
);

select is(
  (select count(*)::int from member_deviations
    where member_record_id = 'dddd5555-0000-0000-0000-00000000000a' and source = 'rfq'),
  2,
  'both survive — this is what the old unique key made impossible'
);

-- But not twice against the SAME option: re-running detection must replace.
select throws_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, option_id, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'rfq', 'dddd5555-0000-0000-0000-000000000012',
             '70 years', '74 years', 'Duplicate.') $$,
  23505,
  null,
  'one finding per life, per term, per option'
);

-- --------------------------------------------------------------------------
-- The expiring policy has no options, and still allows only one.
-- --------------------------------------------------------------------------
select lives_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, expected_value, actual_value, detail, is_continuation)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'expiring_policy', '70 years', '74 years',
             'Above the limit, already on cover.', true) $$,
  'the expiring policy carries no option'
);

-- Null is not a value in a unique constraint, so a single widened key would
-- have silently stopped preventing this. Partial indexes say what is meant.
select throws_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'expiring_policy', '70 years', '74 years', 'Duplicate.') $$,
  23505,
  null,
  'and still only once, despite the null option'
);

-- --------------------------------------------------------------------------
-- The two shapes cannot be mixed up.
-- --------------------------------------------------------------------------
select throws_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'rfq', '70 years', '74 years', 'No option named.') $$,
  23514,
  null,
  'an RFQ deviation that names no option is refused'
);

select throws_ok(
  $$ insert into member_deviations
       (case_id, member_record_id, benefit_key, source, option_id, expected_value, actual_value, detail)
     values ('dddd5555-0000-0000-0000-000000000001', 'dddd5555-0000-0000-0000-00000000000a',
             'dev_max_age_parents', 'expiring_policy', 'dddd5555-0000-0000-0000-000000000011',
             '70 years', '74 years', 'Option on the expiring policy.') $$,
  23514,
  null,
  'and an expiring-policy deviation that names one is too'
);

-- --------------------------------------------------------------------------
-- Deleting an option takes its findings; the roster and the expiring policy's
-- findings are untouched.
-- --------------------------------------------------------------------------
delete from rfq_options where id = 'dddd5555-0000-0000-0000-000000000012';

select is(
  (select count(*)::int from member_deviations
    where source = 'rfq' and member_record_id = 'dddd5555-0000-0000-0000-00000000000a'),
  1,
  'removing an option removes the findings about it'
);

select is(
  (select count(*)::int from member_deviations
    where source = 'expiring_policy' and member_record_id = 'dddd5555-0000-0000-0000-00000000000a'),
  1,
  'and leaves what the expiring policy found alone'
);

select is(
  (select count(*)::int from member_records where id = 'dddd5555-0000-0000-0000-00000000000a'),
  1,
  'nobody is ever removed from the roster — a life outside the terms is flagged, not dropped'
);

select * from finish();
rollback;
