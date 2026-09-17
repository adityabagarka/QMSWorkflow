-- 070_term_direction.sql
-- Whether a changed term is an enhancement or a restriction.
--
-- The governing rule under test is that a wrong answer is worse than no answer.
-- A restriction shown as an enhancement invites the RM to add cost where they
-- should be asking for a discount, so anything the classifier cannot be sure of
-- must come back as a plain 'changed'.

begin;
select plan(18);

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label) values
  ('co_pay', 24, 'Sum insured, limits & copay', 'Co-pay'),
  ('room_rent_limit_normal_room', 20, 'Sum insured, limits & copay', 'Room rent limit'),
  ('maternity_cover', 28, 'Mother & Child', 'Maternity Cover'),
  ('proportionate_deduction_clause', 22, 'Sum insured, limits & copay', 'Proportionate deduction'),
  ('max_age_parents', 8, 'The basics', 'Max age - Parents'),
  ('members_covered', 1, 'The basics', 'Members Covered'),
  ('lgbtq_cover', 2, 'The basics', 'LGBTQ Cover'),
  ('premium_calculation', 58, 'Service & administration', 'Premium calculation')
on conflict (benefit_key) do nothing;

insert into benefit_polarity (benefit_key, polarity) values
  ('co_pay', 'lower_better'),
  ('room_rent_limit_normal_room', 'ordinal'),
  ('maternity_cover', 'higher_better'),
  ('proportionate_deduction_clause', 'absence_better'),
  ('max_age_parents', 'higher_better'),
  ('members_covered', 'none'),
  ('lgbtq_cover', 'presence_better'),
  ('premium_calculation', 'none')
on conflict (benefit_key) do update set polarity = excluded.polarity;

insert into benefit_value_ranks (benefit_key, pattern, rank) values
  ('room_rent_limit_normal_room', 'shared', 1),
  ('room_rent_limit_normal_room', 'twin', 2),
  ('room_rent_limit_normal_room', 'single', 3),
  ('room_rent_limit_normal_room', 'no limit', 5)
on conflict (benefit_key, pattern) do update set rank = excluded.rank;

-- --------------------------------------------------------------------------
-- The number is not the answer: co-pay rising is worse, not better.
-- --------------------------------------------------------------------------
select is(app.classify_term_change('co_pay', '10% co-pay on all claims', '20% co-pay on all claims')::text,
  'restriction', 'Co-pay rising from 10% to 20% is a restriction');
select is(app.classify_term_change('co_pay', '20% co-pay', '10% co-pay')::text,
  'enhancement', 'Co-pay falling is an enhancement');
select is(app.classify_term_change('co_pay', 'None', '10% co-pay')::text,
  'restriction', 'Introducing a co-pay where there was none is a restriction');

-- Whereas for a limit, rising IS better — same shape of value, opposite sense.
select is(app.classify_term_change('maternity_cover', 'Up to ₹50,000', 'Up to ₹75,000')::text,
  'enhancement', 'A maternity limit rising is an enhancement');
select is(app.classify_term_change('maternity_cover', 'Not covered', 'Up to ₹75,000')::text,
  'enhancement', '"Not covered" reads as zero, so adding cover is an enhancement');
select is(app.classify_term_change('maternity_cover', 'Up to ₹75,000', 'Not covered')::text,
  'restriction', 'and withdrawing it is a restriction');

-- --------------------------------------------------------------------------
-- Room rent carries no number at all.
-- --------------------------------------------------------------------------
select is(app.classify_term_change('room_rent_limit_normal_room', 'Twin sharing room', 'Single/Private AC Room')::text,
  'enhancement', 'Twin sharing to a single private room is an enhancement, with no number involved');
select is(app.classify_term_change('room_rent_limit_normal_room', 'Single AC Room', 'Twin sharing room')::text,
  'restriction', 'and the reverse is a restriction');
select is(app.classify_term_change('room_rent_limit_normal_room', 'Single AC Room', 'No limit')::text,
  'enhancement', 'Removing the cap entirely is the best of them');

-- --------------------------------------------------------------------------
-- A clause whose presence restricts.
-- --------------------------------------------------------------------------
select is(app.classify_term_change('proportionate_deduction_clause', 'Not applicable', 'Applicable')::text,
  'restriction', 'Applying proportionate deduction is a restriction, despite reading as something gained');
select is(app.classify_term_change('proportionate_deduction_clause', 'Applicable', 'Not applicable')::text,
  'enhancement', 'and waiving it is an enhancement');

select is(app.classify_term_change('lgbtq_cover', 'Not covered', 'Covered')::text,
  'enhancement', 'Adding a cover is an enhancement');

select is(app.classify_term_change('max_age_parents', '80 years', '85 years')::text,
  'enhancement', 'A higher age ceiling keeps more lives insurable');

-- --------------------------------------------------------------------------
-- Refusing to guess. Each of these is a case where a confident answer would be
-- worse than none.
-- --------------------------------------------------------------------------
select is(app.classify_term_change('members_covered', 'Employee, Spouse, Children, Parents', 'Employee, Spouse, Children, Siblings')::text,
  'changed', 'Swapping parents for siblings is neither better nor worse, and is not claimed to be');

select is(app.classify_term_change('premium_calculation', 'Flat rate', 'Pro-rata')::text,
  'changed', 'A service term has no direction');

select is(app.classify_term_change('maternity_cover', 'As per policy schedule', 'Subject to underwriting')::text,
  'changed', 'Prose on both sides yields no number, so no direction is claimed');

select is(app.classify_term_change('co_pay', '10%', '10%'), 'changed'::app.term_change_kind,
  'An identical value is not a change');

-- A benefit nobody has classified must not be guessed at either.
select is(app.classify_term_change('some_unclassified_key', 'A', 'B')::text,
  'changed', 'An unclassified benefit yields no direction rather than a guess');

select * from finish();
rollback;
