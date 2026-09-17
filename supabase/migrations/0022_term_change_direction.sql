-- 0022_term_change_direction.sql
-- Is a changed term an enhancement or a restriction?
--
-- Worth knowing because the two move price in opposite directions: an
-- enhancement is something to be costed, a restriction something to ask a
-- discount for. Showing them alike leaves the RM to work it out fifty-eight
-- times per option.
--
-- Direction is NOT "the bigger number wins". Co-pay rising from 10% to 20% is a
-- restriction; a room rent limit moving from twin-sharing to a single private
-- AC room is an enhancement with no number in it at all. Each benefit carries
-- its own sense, so the sense is reference data rather than logic.
--
-- The governing rule is that a wrong answer is worse than no answer. A
-- restriction shown as an enhancement invites the RM to add cost where they
-- should be asking for a discount. So every path that cannot be certain returns
-- 'changed' — highlighted as different, with no claim about which way.

create type app.term_polarity as enum (
  'higher_better',    -- sum insured, maternity limit, ambulance cover
  'lower_better',     -- co-pay, deductible, waiting periods
  'presence_better',  -- a cover that is either there or not
  'absence_better',   -- a clause whose presence restricts, e.g. proportionate deduction
  'ordinal',          -- ranked wording: shared -> twin -> single AC -> no limit
  'none'              -- genuinely directionless, or a swap rather than a move
);

create type app.term_change_kind as enum ('enhancement', 'restriction', 'changed');

create table benefit_polarity (
  benefit_key text primary key references benefit_catalogue (benefit_key) on delete cascade,
  polarity    app.term_polarity not null,
  note        text
);

comment on table benefit_polarity is
  'Which way "better" runs for each benefit. Admin-editable reference data, like the guardrails tables — this is domain judgement, not application logic.';

create table benefit_value_ranks (
  benefit_key text not null references benefit_catalogue (benefit_key) on delete cascade,
  pattern     text not null,
  rank        integer not null,
  primary key (benefit_key, pattern)
);

comment on table benefit_value_ranks is
  'Ordered wording for ordinal benefits. `pattern` is matched case-insensitively against the term; the highest matching rank wins, so "Single/Private AC Room" ranks above "Twin sharing" without either being a number.';

-- --------------------------------------------------------------------------
-- Reading a number out of a term.
--
-- Terms are written for humans: "Up to ₹75,000 for both Normal & C-Section",
-- "10% co-pay on all parental claims", "2 years". The first number carries the
-- meaning in nearly all of them.
--
-- Words of absence map to zero, which works in both directions at once: for a
-- maternity limit, zero is the worst value; for a co-pay, zero is the best.
-- --------------------------------------------------------------------------
create or replace function app.term_numeric(v text)
returns numeric
language plpgsql
immutable
as $$
declare
  cleaned text;
  digits  text;
begin
  if v is null then
    return null;
  end if;

  cleaned := lower(trim(v));

  if cleaned in ('none', 'nil', 'not covered', 'not offered', 'not applicable', 'no', '-', 'na', 'n/a') then
    return 0;
  end if;

  digits := substring(replace(cleaned, ',', '') from '[0-9]+\.?[0-9]*');
  if digits is null then
    return null;
  end if;

  return digits::numeric;
exception
  when others then
    return null;
end;
$$;

-- --------------------------------------------------------------------------
-- Is a cover present?  Returns null when the wording does not clearly say.
-- --------------------------------------------------------------------------
create or replace function app.term_present(v text)
returns boolean
language sql
immutable
as $$
  select case
    when v is null then null
    when lower(trim(v)) in ('not covered', 'not offered', 'not applicable', 'none', 'nil', 'no', 'excluded', '-') then false
    when lower(trim(v)) in ('covered', 'applicable', 'yes', 'included', 'available') then true
    when lower(v) like 'not covered%' or lower(v) like 'not offered%' or lower(v) like 'not applicable%' then false
    when lower(v) like 'covered%' or lower(v) like 'up to%' or lower(v) like 'applicable%' then true
    else null
  end;
$$;

create or replace function app.term_rank(p_benefit_key text, v text)
returns integer
language sql
stable
as $$
  select max(r.rank)
  from benefit_value_ranks r
  where r.benefit_key = p_benefit_key
    and v ilike '%' || r.pattern || '%';
$$;

-- --------------------------------------------------------------------------
-- The classification itself.
-- --------------------------------------------------------------------------
create or replace function app.classify_term_change(
  p_benefit_key text,
  p_from        text,
  p_to          text
)
returns app.term_change_kind
language plpgsql
stable
as $$
declare
  pol app.term_polarity;
  a numeric; b numeric;
  pa boolean; pb boolean;
  ra integer; rb integer;
begin
  -- Unchanged is not a change. Compared on trimmed text because a stray space
  -- is not a variation an insurer should be asked to price.
  if p_from is not null and p_to is not null and trim(p_from) = trim(p_to) then
    return 'changed';
  end if;

  select polarity into pol from benefit_polarity where benefit_key = p_benefit_key;
  if pol is null or pol = 'none' then
    return 'changed';
  end if;

  case pol
    when 'higher_better', 'lower_better' then
      a := app.term_numeric(p_from);
      b := app.term_numeric(p_to);
      if a is null or b is null or a = b then
        return 'changed';
      end if;
      if pol = 'higher_better' then
        return case when b > a then 'enhancement' else 'restriction' end;
      else
        return case when b < a then 'enhancement' else 'restriction' end;
      end if;

    when 'presence_better', 'absence_better' then
      pa := app.term_present(p_from);
      pb := app.term_present(p_to);
      if pa is null or pb is null or pa = pb then
        return 'changed';
      end if;
      if pol = 'presence_better' then
        return case when pb then 'enhancement' else 'restriction' end;
      else
        return case when pb then 'restriction' else 'enhancement' end;
      end if;

    when 'ordinal' then
      ra := app.term_rank(p_benefit_key, p_from);
      rb := app.term_rank(p_benefit_key, p_to);
      if ra is null or rb is null or ra = rb then
        return 'changed';
      end if;
      return case when rb > ra then 'enhancement' else 'restriction' end;

    else
      return 'changed';
  end case;
end;
$$;

grant execute on function
  app.term_numeric(text), app.term_present(text),
  app.term_rank(text, text), app.classify_term_change(text, text, text)
to authenticated, service_role;

-- --------------------------------------------------------------------------
-- The RM has the last word.
--
-- This is domain judgement, and the classifier is wrong sometimes by
-- construction. An override on the option's own term both fixes the display and
-- records the disagreement, which is how the reference data gets corrected.
-- --------------------------------------------------------------------------
alter table rfq_option_terms
  add column change_kind_override app.term_change_kind;

comment on column rfq_option_terms.change_kind_override is
  'Set when an RM disagrees with the classifier. Overrides the computed direction and marks the reference data as worth revisiting.';
