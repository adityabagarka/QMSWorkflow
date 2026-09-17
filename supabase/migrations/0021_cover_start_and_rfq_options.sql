-- 0021_cover_start_and_rfq_options.sql
-- The date that matters, and the proposed-terms options built on the expiring
-- policy.

-- --------------------------------------------------------------------------
-- 1. Cover start date.
--
-- The deal is about when the NEW cover begins — that is the date an RM works
-- backwards from, and the one a countdown should count to. `policy_expiry_date`
-- stays, because §11's reminder cascade genuinely keys off when the current
-- programme ends, but it is no longer what screens lead with.
-- --------------------------------------------------------------------------
alter table cases add column cover_start_date date;

comment on column cases.cover_start_date is
  'Inception of the policy being quoted for. The date screens lead with. Distinct from policy_expiry_date, which is when the CURRENT programme ends and drives the §11 reminder cascade.';

-- Existing rows: cover normally begins the day the old policy ends.
update cases
   set cover_start_date = policy_expiry_date + 1
 where cover_start_date is null
   and policy_expiry_date is not null;

create index cases_cover_start_idx on cases (cover_start_date);

-- --------------------------------------------------------------------------
-- 2. Proposed terms, as options on top of the expiring policy.
--
-- A rollover asks for the expiring terms plus changes, so an option is stored
-- as a DIFFERENCE from the expiring policy rather than a fresh set of 58
-- values. Three things follow, all of them wanted:
--
--   - Option 1 is "same as expiring" and holds no rows at all. It cannot drift
--     from the expiring terms, because it has nothing of its own to drift.
--   - "What changed" needs no comparison logic: a row exists, or it does not.
--     That is what the insurer is being asked to look at, and what the customer
--     is shown at comparison.
--   - Correcting an expiring term after options exist flows into every option
--     that had not overridden it, instead of leaving stale copies behind.
-- --------------------------------------------------------------------------
create table rfq_options (
  id         uuid primary key default gen_random_uuid(),
  case_id    uuid not null references cases (id) on delete cascade,
  option_no  integer not null,
  name       text not null,
  created_by uuid not null references app_users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (case_id, option_no),

  -- Option 1 is always the unchanged baseline. Numbering from 1 rather than
  -- calling it "baseline" keeps the insurer's reading simple: every column is
  -- an option they can quote.
  constraint rfq_options_no_positive check (option_no >= 1)
);

comment on table rfq_options is
  'Proposed terms sent to insurers. Option 1 is the expiring terms unchanged and holds no override rows; options 2+ each vary one or more terms. Names are editable, because "+ maternity 75k, - parents" stops describing an option once several terms move.';

create table rfq_option_terms (
  option_id   uuid not null references rfq_options (id) on delete cascade,
  case_id     uuid not null references cases (id) on delete cascade,
  benefit_key text not null references benefit_catalogue (benefit_key) on delete restrict,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (option_id, benefit_key)
);

comment on table rfq_option_terms is
  'Only the benefits an option CHANGES. Absence means "same as expiring" — so a changed cell is exactly a row that exists, with no diffing.';

create index rfq_options_case_idx on rfq_options (case_id, option_no);
create index rfq_option_terms_case_idx on rfq_option_terms (case_id);

create trigger rfq_options_touch_updated_at
  before update on rfq_options
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- RLS: both inherit the case, like every other descendant (§15).
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rfq_options', 'rfq_option_terms'] loop
    execute format('alter table %I enable row level security', t);
    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app.can_read_case(app.case_owner(case_id)))
    $f$, t);
    execute format($f$
      create policy %1$I_write on %1$I for all to authenticated
        using (app.can_write_case(app.case_owner(case_id)))
        with check (app.can_write_case(app.case_owner(case_id)))
    $f$, t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- Every option's full term set: the expiring value, overridden where the option
-- changes it. One place, so the RFQ pack, the comparison table and the terms
-- screen cannot disagree about what was proposed.
-- --------------------------------------------------------------------------
create or replace function app.option_terms(p_option_id uuid)
returns table (
  benefit_key   text,
  section       text,
  benefit_label text,
  display_order integer,
  expiring_value text,
  value         text,
  is_changed    boolean
)
language sql
stable
as $$
  select
    b.benefit_key,
    b.section,
    b.benefit_label,
    b.display_order,
    pt.value as expiring_value,
    coalesce(ot.value, pt.value) as value,
    ot.option_id is not null as is_changed
  from rfq_options o
  join benefit_catalogue b on true
  left join policies p on p.case_id = o.case_id
  left join policy_terms pt
    on pt.policy_id = p.id and pt.benefit_key = b.benefit_key
  left join rfq_option_terms ot
    on ot.option_id = o.id and ot.benefit_key = b.benefit_key
  where o.id = p_option_id
  order by b.display_order;
$$;

grant execute on function app.option_terms(uuid) to authenticated, service_role;
