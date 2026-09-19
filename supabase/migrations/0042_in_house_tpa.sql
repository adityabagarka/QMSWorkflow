-- ════════════════════════════════════════════════════════════════════════════
-- 0042 — "In-house" is a real answer to "who administers the claims".
--
-- The TPA list was the IRDAI register of third-party administrators, which is
-- correct and incomplete: most of the private general insurers and every
-- standalone health insurer run their own claims desk. ICICI Lombard's
-- schedules name "ICICI Lombard Healthcare"; TATA AIG's name "TATA AIG
-- Corporate Health Claims". Those are not third parties.
--
-- Without this the field could only be left blank, which reads as "not
-- captured" — and an underwriter asking who services the claims gets a
-- different answer from "nobody told us" than from "the insurer does".
-- ════════════════════════════════════════════════════════════════════════════

alter table tpas add column is_in_house boolean not null default false;

comment on column tpas.is_in_house is
  'True for the standing "In-house" option, which is not a registered TPA but is the commonest answer: the insurer administers its own claims.';

insert into tpas (legal_name, short_name, aliases, is_in_house)
values (
  'In-house (administered by the insurer)',
  'In-house',
  -- What the schedules actually print where the insurer services its own
  -- claims, so a policy naming one of these resolves here rather than creating
  -- a TPA that does not exist.
  '{"In house","Inhouse","In-house","Insurer","Self","Company","ICICI Lombard Healthcare","TATA AIG Corporate Health Claims","HDFC ERGO Health","Star Health","Niva Bupa","Care Health","Aditya Birla Health","ManipalCigna"}',
  true
)
on conflict (fold_key) do update
  set legal_name  = excluded.legal_name,
      short_name  = excluded.short_name,
      aliases     = excluded.aliases,
      is_in_house = true,
      active      = true;
