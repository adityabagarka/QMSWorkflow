-- ════════════════════════════════════════════════════════════════════════════
-- 0038 — resolve a broker by what people call them, not only by what they
-- are registered as.
--
-- `resolve_broker` matched the legal name and the aliases and skipped the
-- short name, which is the one form anybody actually types. "Marsh India
-- Insurance Brokers Private Limited" folds to "marsh india"; somebody writing
-- "Marsh" got a second record, which is exactly the split this table exists to
-- prevent.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.resolve_broker(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_fold text := app.fold_party_name(p_name);
  v_id   uuid;
begin
  if v_fold is null then
    return null;
  end if;

  -- The registered name, what we call them, and anything else they have been
  -- called — all equal ways of naming the same broker.
  select coalesce(b.merged_into, b.id) into v_id
    from brokers b
   where exists (
     select 1
       from unnest(b.aliases || b.legal_name || b.short_name) a
      where app.fold_party_name(a) = v_fold
   )
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into brokers (legal_name, short_name)
  values (trim(p_name), trim(p_name))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.resolve_broker(text) is
  'The broker id for a typed name — matched on the registered name, the short name or any alias — creating one where the name is new. Never blocks: a broker nobody has recorded is an ordinary fact about a deal.';
