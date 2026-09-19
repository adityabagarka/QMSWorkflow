-- ════════════════════════════════════════════════════════════════════════════
-- 0039 — what shape of answer each benefit takes.
--
-- Every one of the fifty-eight was a free text box. Most of them are not free
-- text: "Covered", "Not covered", "Not applicable" is the whole vocabulary for
-- about half the catalogue, and typing it by hand produces "covered",
-- "Covered", "Yes", "Y" — four answers to a yes/no question, none of which can
-- be counted or compared across deals.
--
-- Three kinds, and a free-text escape on all of them. A genuinely bespoke
-- policy is a real thing and must never be blocked by a list; it just should
-- not be the default path when the answer is one of three words.
--
-- The vocabulary lives in its own table rather than as columns on
-- `benefit_catalogue`, which is not cosmetic. The first attempt put them there
-- and set them with UPDATE statements — and on a fresh database that table is
-- EMPTY when migrations run, because the guardrails workbook is imported
-- afterwards. Every update matched zero rows and the kinds silently did not
-- exist; it appeared to work only because the development database already had
-- the catalogue loaded. Same shape of mistake as the review gate that was
-- vacuously true on an empty catalogue: a migration whose effect depends on
-- data that has not arrived yet.
--
-- Keyed by benefit_key, seeded whether or not the catalogue is loaded, and
-- untouched by the import.
--
-- Deliberately no foreign key. A key here has to be writable before the
-- catalogue exists, which is the entire point. `app.orphan_input_specs`
-- reports keys naming no benefit instead — the rule is checked rather than
-- constrained, because constraining it would recreate the ordering problem
-- this table exists to avoid.
-- ════════════════════════════════════════════════════════════════════════════

create table benefit_input_spec (
  benefit_key text primary key,
  input_kind  text not null default 'choice'
    check (input_kind in ('choice', 'amount', 'text')),
  suggestions text[] not null default '{}'
);

comment on table benefit_input_spec is
  'What shape of answer a benefit takes, and its seeded vocabulary. Keyed by benefit_catalogue.benefit_key (§4.1) but not constrained to it: this is seeded by migration and the catalogue arrives by import.';
comment on column benefit_input_spec.input_kind is
  'choice: a short option set. amount: a figure with a unit. text: genuinely free-form. All three accept a typed value that is not in the list.';
comment on column benefit_input_spec.suggestions is
  'The seeded vocabulary, written most-likely-first. What is actually offered is this plus what real deals have recorded, so the list improves with use rather than by migration.';

insert into benefit_input_spec (benefit_key, input_kind, suggestions) values
  ('room_rent_limit_normal_room', 'amount', array['Up to 1% of sum insured per day', 'Up to 2% of sum insured per day', 'Single private AC room', 'Twin sharing room', 'General ward', 'No limit', 'Not applicable']),
  ('room_rent_limit_icu', 'amount', array['Up to 2% of sum insured per day', 'Up to 4% of sum insured per day', 'At actuals', 'No limit', 'Not applicable']),
  ('sum_insured', 'amount', array['No limit', 'Not applicable']),
  ('corporate_buffer', 'amount', array['No limit', 'Not applicable']),
  ('deductible', 'amount', array['No limit', 'Not applicable']),
  ('attendant_charges', 'amount', array['No limit', 'Not applicable']),
  ('air_ambulance', 'amount', array['No limit', 'Not applicable']),
  ('road_ambulance', 'amount', array['No limit', 'Not applicable']),
  ('nursing_allowance', 'amount', array['No limit', 'Not applicable']),
  ('hospital_cash_benefit', 'amount', array['No limit', 'Not applicable']),
  ('family_transportation', 'amount', array['No limit', 'Not applicable']),
  ('disease_wise_capping', 'amount', array['No limit', 'Not applicable']),
  ('cataract', 'amount', array['No limit', 'Not applicable']),
  ('lucentis', 'amount', array['No limit', 'Not applicable']),
  ('cochlear_implant', 'amount', array['No limit', 'Not applicable']),
  ('maternity_cover', 'amount', array['No limit', 'Not applicable']),
  ('well_mother_well_baby_expenses', 'amount', array['No limit', 'Not applicable']),
  ('age_band', 'text', array['91 days to 80 years', '1 day to 80 years', '91 days to 65 years']),
  ('max_age_employee_spouse', 'text', array['65 years', '70 years', '75 years', '80 years', 'No limit']),
  ('max_age_parents', 'text', array['65 years', '70 years', '75 years', '80 years', 'No limit']),
  ('max_age_children', 'text', array['21 years', '25 years', '26 years', 'No limit']),
  ('pre_existing_diseases', 'choice', array['Waived off', 'Covered', 'Not covered']),
  ('30_day_year_waiting_period', 'choice', array['Waived off', 'Covered', 'Not covered']),
  ('specified_illness_waiting_period', 'choice', array['Waived off', 'Covered', 'Not covered']),
  ('proportionate_deduction_clause', 'choice', array['None', 'Applicable', 'Not applicable']),
  ('co_pay', 'choice', array['None', '10% on all claims', '10% on parental claims', '20% on parental claims']),
  ('pre_post_hospitalisation_expenses', 'text', array['30 days pre and 60 days post', '30 days pre and 90 days post', '60 days pre and 90 days post', 'Not covered']),
  ('no_of_children_covered_within_maternity', 'text', array['1', '2', 'No limit']),
  ('cover_for_new_born_baby_from_day_1', 'choice', array['Covered from day 1', 'Covered after 90 days', 'Not covered']),
  ('addition_deletion_of_employees', 'text', array['Within 30 days of joining', 'Within 30 days of the event', 'Monthly endorsement', 'At inception only']),
  ('addition_deletion_of_family_members', 'text', array['Within 30 days of joining', 'Within 30 days of the event', 'Monthly endorsement', 'At inception only']),
  ('premium_calculation', 'text', array['Prorata', 'Full year premium', 'Half yearly slab'])on conflict (benefit_key) do update
  set input_kind  = excluded.input_kind,
      suggestions = excluded.suggestions;

-- Every benefit not named above is a plain choice with the default vocabulary.
-- "Not applicable" and "Not covered" are kept apart deliberately: an insurer
-- reads them differently, and a deal saying one where it meant the other is
-- quoting different cover.
create or replace function app.benefit_input_kind(p_benefit_key text)
returns text
language sql
stable
as $$
  select coalesce(
    (select input_kind from benefit_input_spec where benefit_key = p_benefit_key),
    'choice'
  );
$$;

create or replace function app.orphan_input_specs()
returns table (benefit_key text)
language sql
stable
as $$
  select s.benefit_key
    from benefit_input_spec s
   where not exists (select 1 from benefit_catalogue b where b.benefit_key = s.benefit_key);
$$;

comment on function app.orphan_input_specs() is
  'Input specs naming a benefit the catalogue does not hold. Empty once the workbook is imported; a name here is a typo or a benefit that has been renamed.';

-- --------------------------------------------------------------------------
-- What to offer for a benefit: the seeded vocabulary first, in the order it
-- was written, then the values real deals have used, most used first.
--
-- The seeded order matters. The whole value of a suggestion list is that the
-- common answer is the nearest one, and ranking every seeded value equally
-- made the list alphabetical — "Not applicable" above "Covered".
-- --------------------------------------------------------------------------
create or replace function app.benefit_suggestions(p_benefit_key text, p_limit integer default 12)
returns text[]
language sql
stable
as $$
  with seeded as (
    select s.value, 0 as rank, s.ordinality::bigint as position
      from benefit_input_spec spec,
           lateral unnest(spec.suggestions) with ordinality as s(value, ordinality)
     where spec.benefit_key = p_benefit_key
  ),
  fallback as (
    select value, 0 as rank, ordinality::bigint as position
      from unnest(array['Covered', 'Not covered', 'Not applicable'])
             with ordinality as f(value, ordinality)
     where not exists (select 1 from benefit_input_spec where benefit_key = p_benefit_key)
  ),
  used as (
    -- A value recorded on twenty deals is worth offering; one typed once is
    -- noise the limit trims off.
    select t.value, 1 as rank, -count(*) as position
      from policy_terms t
     where t.benefit_key = p_benefit_key
       and t.value is not null
       and length(t.value) between 1 and 120
     group by t.value
  ),
  merged as (
    select value, min(rank) as rank, min(position) as position
      from (
        select * from seeded
        union all select * from fallback
        union all select * from used
      ) all_of_them
     group by value
  )
  select coalesce(array_agg(value order by rank, position), '{}')
    from (select * from merged order by rank, position limit p_limit) top;
$$;

-- The terms step needs all fifty-eight at once. Per-benefit calls would be
-- fifty-eight round trips to render one screen.
create or replace function app.all_benefit_suggestions(p_limit integer default 12)
returns table (benefit_key text, input_kind text, suggestions text[])
language sql
stable
as $$
  select b.benefit_key,
         app.benefit_input_kind(b.benefit_key),
         app.benefit_suggestions(b.benefit_key, p_limit)
    from benefit_catalogue b;
$$;

create or replace function public.all_benefit_suggestions(p_limit integer default 12)
returns table (benefit_key text, input_kind text, suggestions text[])
language sql
stable
as $$ select * from app.all_benefit_suggestions(p_limit) $$;

alter table benefit_input_spec enable row level security;

create policy benefit_input_spec_select on benefit_input_spec
  for select to authenticated using (app.is_active_user());

grant select on benefit_input_spec to authenticated;
grant execute on function
  app.benefit_input_kind(text),
  app.orphan_input_specs(),
  app.benefit_suggestions(text, integer),
  app.all_benefit_suggestions(integer),
  public.all_benefit_suggestions(integer)
to authenticated, service_role;
