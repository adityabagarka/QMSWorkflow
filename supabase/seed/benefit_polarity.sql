-- Which way "better" runs, per benefit. Seed data for benefit_polarity.
--
-- Reference data, not logic: this is domain judgement and Admins can correct it
-- through the console, the same as the guardrails tables. Re-runnable.
--
-- Where a benefit is left 'none', that is a decision rather than an omission —
-- see the notes at the foot.

insert into benefit_polarity (benefit_key, polarity, note) values
  -- The basics ------------------------------------------------------------
  ('members_covered',        'none',            'Swapping parents for siblings is a different cover, not a better or worse one. Left for the RM to judge.'),
  ('lgbtq_cover',            'presence_better', null),
  ('live_in_partner_cover',  'presence_better', null),
  ('siblings',               'presence_better', null),
  ('age_band',               'none',            'A range: widening one end and narrowing the other has no single direction.'),
  ('max_age_employee_spouse','higher_better',   'A higher ceiling keeps more lives insurable.'),
  ('max_age_children',       'higher_better',   null),
  ('max_age_parents',        'higher_better',   null),

  -- Expenses covered ------------------------------------------------------
  ('type_of_hospitalisation_ipd', 'presence_better', null),
  ('type_of_hospitalisation_opd', 'presence_better', null),
  ('daycare_treatments',          'presence_better', null),
  ('domiciliary_hospitalisation', 'presence_better', null),
  ('pre_post_hospitalisation_expenses', 'higher_better', 'More days, or a higher cap, covers more.'),
  ('road_ambulance',              'higher_better', null),
  ('air_ambulance',               'higher_better', null),
  ('pre_existing_diseases',       'presence_better', 'Day-one cover reads as covered; a waiting period reads as not.'),
  ('30_day_year_waiting_period',  'lower_better',  'A shorter wait is better cover.'),
  ('specified_illness_waiting_period', 'lower_better', null),

  -- Sum insured, limits & copay -------------------------------------------
  ('sum_insured',                    'higher_better', null),
  ('room_rent_limit_normal_room',    'ordinal',       'Ranked by wording, not number — see benefit_value_ranks.'),
  ('room_rent_limit_icu',            'ordinal',       null),
  ('proportionate_deduction_clause', 'absence_better','The clause cuts every claim when room rent is exceeded, so its presence is the restriction.'),
  ('attendant_charges',              'higher_better', null),
  ('co_pay',                         'lower_better',  'Every percentage point is paid by the member.'),
  ('deductible',                     'lower_better',  null),
  ('disease_wise_capping',           'absence_better','A cap per disease limits the claim; removing it is the enhancement.'),
  ('corporate_buffer',               'higher_better', null),

  -- Mother & Child --------------------------------------------------------
  ('maternity_cover',                         'higher_better', null),
  ('no_of_children_covered_within_maternity', 'higher_better', null),
  ('pre_and_post_natal_expenses',             'higher_better', null),
  ('well_mother_well_baby_expenses',          'higher_better', null),
  ('cover_for_new_born_baby_from_day_1',      'presence_better', null),
  ('infertility_treatments',                  'presence_better', null),
  ('surrogacy_related_treatments',            'presence_better', null),

  -- Alternate & new age treatments ----------------------------------------
  ('internal_congenital_disease',                  'presence_better', null),
  ('external_congenital_disease',                  'presence_better', null),
  ('mental_illness_hospitalisation',               'presence_better', null),
  ('psychiatric_ailments',                         'presence_better', null),
  ('functional_endoscopic_surgery',                'presence_better', null),
  ('modern_treatments_e_g_cyber_knife_stem_cell',  'presence_better', null),
  ('cochlear_implant',                             'presence_better', null),
  ('organ_donor_expenses',                         'presence_better', null),
  ('gender_re_affirming_surgeries_and_treatments', 'presence_better', null),
  ('ayush_treatments_e_g_ayurveda_homeopathy',     'presence_better', null),

  -- Vision & dental -------------------------------------------------------
  ('cataract',                          'higher_better',  'Usually a per-eye cap; a higher cap covers more.'),
  ('lasik_surgery',                     'presence_better', null),
  ('lucentis',                          'presence_better', null),
  ('accident_related_dental_treatment', 'presence_better', null),

  -- Additional covers -----------------------------------------------------
  ('terrorism',              'presence_better', null),
  ('covid_19_treatments',    'presence_better', null),
  ('bereavement_cover',      'higher_better',   null),
  ('widow_widower_cover',    'presence_better', null),
  ('family_transportation',  'higher_better',   null),
  ('nursing_allowance',      'higher_better',   null),
  ('hospital_cash_benefit',  'higher_better',   null),

  -- Service & administration ----------------------------------------------
  ('addition_deletion_of_employees',      'none', 'A service term. Pro-rata versus flat is a commercial preference, not more or less cover.'),
  ('addition_deletion_of_family_members', 'none', null),
  ('premium_calculation',                 'none', 'Describes how premium is worked out, not what is covered.')
on conflict (benefit_key) do update
  set polarity = excluded.polarity,
      note     = excluded.note;

-- --------------------------------------------------------------------------
-- Ordered wording for the room rent limits.
--
-- Room rent is the clearest case for why direction cannot be read off a number:
-- "Single/Private AC Room" is better cover than "Twin sharing" and neither
-- contains a figure, while a percentage-of-sum-insured cap is a number where
-- higher is better. Ranking the wording handles both.
-- --------------------------------------------------------------------------
insert into benefit_value_ranks (benefit_key, pattern, rank) values
  ('room_rent_limit_normal_room', 'general ward',      1),
  ('room_rent_limit_normal_room', 'shared',            1),
  ('room_rent_limit_normal_room', 'twin',              2),
  ('room_rent_limit_normal_room', 'single',            3),
  ('room_rent_limit_normal_room', 'private',           3),
  ('room_rent_limit_normal_room', 'deluxe',            4),
  ('room_rent_limit_normal_room', 'no limit',          5),
  ('room_rent_limit_normal_room', 'no capping',        5),
  ('room_rent_limit_normal_room', 'at actuals',        5),
  ('room_rent_limit_icu',         'shared',            1),
  ('room_rent_limit_icu',         'single',            3),
  ('room_rent_limit_icu',         'no limit',          5),
  ('room_rent_limit_icu',         'no capping',        5),
  ('room_rent_limit_icu',         'at actuals',        5)
on conflict (benefit_key, pattern) do update set rank = excluded.rank;
