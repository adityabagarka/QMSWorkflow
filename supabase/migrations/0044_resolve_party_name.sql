-- ════════════════════════════════════════════════════════════════════════════
-- 0044 — a name off a schedule, resolved to the party we hold.
--
-- The reader hands back what the document prints. A schedule says "ICICI
-- Lombard Healthcare" for the claims desk and "PLUM BENEFITS INSURANCE BROKERS
-- PRIVATE LIMITED" for the broker; the app offers "In-house" and "Plum". Those
-- are the same parties, and the aliases that say so have been in the database
-- since 0034 — but nothing put a read value through them, so the TPA dropdown
-- had no option to match and fell back to "Select…", and the broker field kept
-- the registered name.
--
-- Resolution happens in SQL because the fold does (0034): one implementation,
-- or the two drift and a name matches in one place and not the other.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.resolve_party_name(p_kind text, p_name text)
returns text
language plpgsql
stable
as $$
declare
  v_fold  text := app.fold_party_name(p_name);
  v_short text;
begin
  if v_fold is null then
    return null;
  end if;

  if p_kind = 'insurer' then
    select i.short_name into v_short
      from insurers i
     where i.active
       and exists (
         select 1 from unnest(i.aliases || i.legal_name || i.short_name) a
          where app.fold_party_name(a) = v_fold
       )
     limit 1;

  elsif p_kind = 'tpa' then
    select t.short_name into v_short
      from tpas t
     where t.active
       and exists (
         select 1 from unnest(t.aliases || t.legal_name || t.short_name) a
          where app.fold_party_name(a) = v_fold
       )
     limit 1;

  elsif p_kind = 'broker' then
    select b.short_name into v_short
      from brokers b
     where exists (
         select 1 from unnest(b.aliases || b.legal_name || b.short_name) a
          where app.fold_party_name(a) = v_fold
       )
     limit 1;
  end if;

  -- Null where nothing matched, never a guess. An insurer or TPA outside the
  -- register is a mistake to look at; a broker we have not met is created on
  -- save by `resolve_broker`, which is a different question from what to show.
  return v_short;
end;
$$;

comment on function app.resolve_party_name(text, text) is
  'The short name we hold for a party named on a policy schedule, matched through the same fold and aliases as everything else. Null where nothing matches — never a near miss.';

grant execute on function app.resolve_party_name(text, text) to authenticated, service_role;

create or replace function public.resolve_party_name(p_kind text, p_name text)
returns text
language sql
stable
as $$ select app.resolve_party_name(p_kind, p_name) $$;

grant execute on function public.resolve_party_name(text, text) to authenticated, service_role;
