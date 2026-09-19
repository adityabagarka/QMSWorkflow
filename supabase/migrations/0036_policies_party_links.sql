-- ════════════════════════════════════════════════════════════════════════════
-- 0036 — point the expiring policy at the party records, not just at a string.
--
-- The text columns stay. They hold what was actually typed or read off the
-- schedule, which is provenance worth keeping — "BAJAJ ALLIANZ GEN INS CO LTD"
-- is how that policy names its insurer, and overwriting it with our tidy
-- version would lose that. The ids are what screens and analytics use.
-- ════════════════════════════════════════════════════════════════════════════

alter table policies
  add column insurer_id uuid references insurers (id) on delete restrict,
  add column tpa_id     uuid references tpas (id) on delete restrict,
  add column broker_id  uuid references brokers (id) on delete restrict;

create index policies_insurer_idx on policies (insurer_id);
create index policies_broker_idx on policies (broker_id);

-- --------------------------------------------------------------------------
-- Backfill from what is already stored, through the same fold the app will
-- use. A name that does not resolve is left null rather than guessed at: a
-- wrong incumbent is carried into an RFQ, and a blank is asked about.
-- --------------------------------------------------------------------------
update policies p
   set insurer_id = i.id
  from insurers i
 where p.insurer_id is null
   and p.insurer_name is not null
   and (
     i.fold_key = app.fold_party_name(p.insurer_name)
     or exists (
       select 1 from unnest(i.aliases) a
        where app.fold_party_name(a) = app.fold_party_name(p.insurer_name)
     )
   );

update policies p
   set tpa_id = t.id
  from tpas t
 where p.tpa_id is null
   and p.tpa_name is not null
   and (
     t.fold_key = app.fold_party_name(p.tpa_name)
     or exists (
       select 1 from unnest(t.aliases) a
        where app.fold_party_name(a) = app.fold_party_name(p.tpa_name)
     )
   );

update policies p
   set broker_id = b.id
  from brokers b
 where p.broker_id is null
   and p.broker_name is not null
   and b.fold_key = app.fold_party_name(p.broker_name);

comment on column policies.insurer_id is
  'The incumbent insurer as a record. `insurer_name` keeps what the schedule actually called them.';
comment on column policies.broker_id is
  'The incumbent broker as a record, created on first sight by app.resolve_broker if it was not already known.';
