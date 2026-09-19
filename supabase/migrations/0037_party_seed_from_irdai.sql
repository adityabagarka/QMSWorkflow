-- ════════════════════════════════════════════════════════════════════════════
-- 0037 — the insurer and TPA lists, corrected against the IRDAI register.
--
-- 0035 seeded these from working knowledge because the build environment
-- cannot reach irdai.gov.in. The register itself has now been read, and it
-- disagreed in ways that matter — four insurers have been renamed since the
-- names I knew, and a third of the TPAs I listed are no longer registered:
--
--   Bajaj Allianz General      → Bajaj General Insurance Limited
--   Future Generali India      → Generali Central Insurance Company Limited
--   Reliance General           → IndusInd General Insurance Company Limited
--   Edelweiss General          → Zuno General Insurance Ltd.
--   East West Assist TPA       → Volo Health Insurance TPA Pvt. Ltd.
--   Safeway TPA                → Health Assist Insurance TPA Pvt. Ltd.
--
-- Former names are kept as aliases rather than dropped: a policy issued three
-- years ago says "Reliance General" on its schedule, and the reader has to
-- resolve that to the company that now carries the book.
--
-- Registration numbers are still absent. The register lists them, but this
-- migration takes only what was read with certainty — the TPA numbers were
-- legible and the insurer ones were not, and a half-filled column invites the
-- assumption that a blank means "none".
-- ════════════════════════════════════════════════════════════════════════════


-- --------------------------------------------------------------------------
-- 0. Fix the fold first.
--
-- 0034's word list was too aggressive: it stripped "health", "india" and
-- "general", which are not structural padding — they are the part of the name
-- that does the distinguishing. "Health India Insurance TPA Services" and
-- "Health Insurance TPA of India" are two different registered TPAs, and both
-- folded to nothing at all.
--
-- What comes out now is only what never distinguishes one party from another:
-- the legal form, the trade, and the articles.
--
-- The generated columns are dropped and re-added rather than left alone: a
-- stored generated column is not recomputed when the function behind it
-- changes, so the indexes would otherwise hold folds from the old rules.
-- --------------------------------------------------------------------------
create or replace function app.fold_party_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_name, '')),
          '\m(private|pvt|limited|ltd|llp|company|companies|co|corporation|corp|insurance|assurance|broking|brokers|broker|services|service|tpa|third party administrator|the|and)\M|[^a-z0-9 ]',
          ' ',
          'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

drop index insurers_fold_key_idx;
drop index tpas_fold_key_idx;
drop index brokers_fold_key_idx;

alter table insurers drop column fold_key;
alter table tpas     drop column fold_key;
alter table brokers  drop column fold_key;

alter table insurers add column fold_key text generated always as (app.fold_party_name(legal_name)) stored;
alter table tpas     add column fold_key text generated always as (app.fold_party_name(legal_name)) stored;
alter table brokers  add column fold_key text generated always as (app.fold_party_name(legal_name)) stored;

create unique index insurers_fold_key_idx on insurers (fold_key);
create unique index tpas_fold_key_idx on tpas (fold_key);
create unique index brokers_fold_key_idx on brokers (fold_key);

-- --------------------------------------------------------------------------
-- 0b. Drop the guessed rows the register renamed outright.
--
-- Only where nothing points at them — a row a deal references is history and
-- gets deactivated below instead. These were seeded hours ago and never
-- deployed, so there is nothing to preserve.
-- --------------------------------------------------------------------------
delete from insurers i
 where i.legal_name in (
   'Bajaj Allianz General Insurance Company Limited',
   'Future Generali India Insurance Company Limited',
   'Reliance General Insurance Company Limited',
   'Zuno General Insurance Limited',
   'Edelweiss General Insurance Company Limited',
   'Star Health and Allied Insurance Company Limited',
   'Niva Bupa Health Insurance Company Limited',
   'Care Health Insurance Limited',
   'Aditya Birla Health Insurance Company Limited',
   'ManipalCigna Health Insurance Company Limited',
   'Narayana Health Insurance Limited',
   'Galaxy Health and Allied Insurance Company Limited',
   'Magma General Insurance Limited',
   'Liberty General Insurance Limited',
   'Shriram General Insurance Company Limited',
   'Navi General Insurance Limited',
   'Acko General Insurance Limited',
   'Kotak Mahindra General Insurance Company Limited'
 )
   and not exists (select 1 from policies p where p.insurer_id = i.id);

delete from tpas t
 where not exists (select 1 from policies p where p.tpa_id = t.id);

-- --------------------------------------------------------------------------
-- 1. Retire what the register does not list.
--
-- Deactivated, never deleted: a deal recorded last year against a TPA that has
-- since surrendered its registration is a true fact about that deal, and the
-- foreign key from `policies` has to keep resolving.
-- --------------------------------------------------------------------------
update insurers set active = false where legal_name not in (
  'Acko General Insurance Limited',
  'Agriculture Insurance Company of India Limited',
  'Bajaj General Insurance Limited',
  'Cholamandalam MS General Insurance Company Limited',
  'ECGC Limited',
  'Generali Central Insurance Company Limited',
  'Go Digit General Insurance Limited',
  'HDFC ERGO General Insurance Company Limited',
  'ICICI Lombard General Insurance Company Limited',
  'IFFCO Tokio General Insurance Company Limited',
  'Zurich Kotak General Insurance Company (India) Limited',
  'Kshema General Insurance Limited',
  'Liberty General Insurance Limited',
  'Magma General Insurance Limited',
  'National Insurance Company Limited',
  'Navi General Insurance Limited',
  'Raheja QBE General Insurance Co. Ltd.',
  'IndusInd General Insurance Company Limited',
  'Royal Sundaram General Insurance Company Limited',
  'SBI General Insurance Company Limited',
  'Shriram General Insurance Company Limited',
  'Tata AIG General Insurance Company Limited',
  'The New India Assurance Company Limited',
  'The Oriental Insurance Company Limited',
  'United India Insurance Company Limited',
  'Universal Sompo General Insurance Company Limited',
  'Zuno General Insurance Ltd.',
  'Kiwi General Insurance Limited',
  'Aditya Birla Health Insurance Co. Ltd.',
  'Care Health Insurance Ltd.',
  'Galaxy Health Insurance Company Limited',
  'Narayana Health Insurance Ltd.',
  'ManipalCigna Health Insurance Company Limited',
  'Niva Bupa Health Insurance Co Ltd.',
  'Prudential HCL Health Insurance Limited',
  'Star Health & Allied Insurance Co. Ltd.'
);

update tpas set active = false where legal_name not in (
  'Medi Assist Insurance TPA Private Limited',
  'MDIndia Health Insurance TPA Private Limited',
  'Paramount Health Services & Insurance TPA Private Limited',
  'Heritage Health Insurance TPA Private Limited',
  'Family Health Plan Insurance TPA Limited',
  'Vidal Health Insurance TPA Private Limited',
  'Volo Health Insurance TPA Pvt. Ltd.',
  'Medsave Health Insurance TPA Limited',
  'Genins India Insurance TPA Limited',
  'Health India Insurance TPA Services Private Limited',
  'Good Health Insurance TPA Limited',
  'Park Mediclaim Insurance TPA Private Limited',
  'Health Assist Insurance TPA Pvt. Ltd.',
  'Ericson Insurance TPA Private Limited',
  'Health Insurance TPA of India Limited',
  'Link-K Insurance TPA Private Limited',
  'AKNA Health Insurance TPA Private Limited'
);

-- --------------------------------------------------------------------------
-- 2. The register, as it stands.
--
-- `on conflict` updates rather than skips, because the point of this migration
-- is to correct what 0035 got wrong.
-- --------------------------------------------------------------------------
insert into insurers (legal_name, short_name, category, aliases) values
  ('Acko General Insurance Limited', 'Acko', 'general', '{"ACKO"}'),
  ('Agriculture Insurance Company of India Limited', 'AIC', 'general', '{"Agriculture Insurance Company of India","AIC of India"}'),
  ('Bajaj General Insurance Limited', 'Bajaj', 'general', '{"Bajaj Allianz","Bajaj Allianz General Insurance Company Limited","BAGIC"}'),
  ('Cholamandalam MS General Insurance Company Limited', 'Chola MS', 'general', '{"Cholamandalam","Chola"}'),
  ('ECGC Limited', 'ECGC', 'general', '{"Export Credit Guarantee Corporation"}'),
  ('Generali Central Insurance Company Limited', 'Generali Central', 'general', '{"Future Generali","Future Generali India Insurance Company Limited","Generali"}'),
  ('Go Digit General Insurance Limited', 'Go Digit', 'general', '{"Digit"}'),
  ('HDFC ERGO General Insurance Company Limited', 'HDFC ERGO', 'general', '{"HDFC Ergo","Ergo"}'),
  ('ICICI Lombard General Insurance Company Limited', 'ICICI Lombard', 'general', '{"Lombard","ILGIC"}'),
  ('IFFCO Tokio General Insurance Company Limited', 'IFFCO Tokio', 'general', '{"IFFCO","Tokio"}'),
  ('Zurich Kotak General Insurance Company (India) Limited', 'Zurich Kotak', 'general', '{"Kotak General","Kotak Mahindra General","Kotak Mahindra General Insurance Company Limited"}'),
  ('Kshema General Insurance Limited', 'Kshema', 'general', '{}'),
  ('Liberty General Insurance Limited', 'Liberty', 'general', '{"Liberty General","Liberty Videocon"}'),
  ('Magma General Insurance Limited', 'Magma', 'general', '{"Magma HDI","Magma HDI General Insurance Company Limited"}'),
  ('National Insurance Company Limited', 'National Insurance', 'general', '{"NIC"}'),
  ('Navi General Insurance Limited', 'Navi', 'general', '{"Navi General"}'),
  ('Raheja QBE General Insurance Co. Ltd.', 'Raheja QBE', 'general', '{"QBE"}'),
  ('IndusInd General Insurance Company Limited', 'IndusInd General', 'general', '{"Reliance General","Reliance General Insurance Company Limited","RGICL","Reliance"}'),
  ('Royal Sundaram General Insurance Company Limited', 'Royal Sundaram', 'general', '{"Royal Sundram"}'),
  ('SBI General Insurance Company Limited', 'SBI General', 'general', '{"SBI"}'),
  ('Shriram General Insurance Company Limited', 'Shriram', 'general', '{"Shriram General"}'),
  ('Tata AIG General Insurance Company Limited', 'Tata AIG', 'general', '{"TATA AIG","AIG"}'),
  ('The New India Assurance Company Limited', 'New India Assurance', 'general', '{"New India","NIA"}'),
  ('The Oriental Insurance Company Limited', 'Oriental Insurance', 'general', '{"Oriental","OICL"}'),
  ('United India Insurance Company Limited', 'United India', 'general', '{"UIIC"}'),
  ('Universal Sompo General Insurance Company Limited', 'Universal Sompo', 'general', '{"Sompo"}'),
  ('Zuno General Insurance Ltd.', 'Zuno', 'general', '{"Edelweiss General","Edelweiss General Insurance Company Limited","Edelweiss"}'),
  ('Kiwi General Insurance Limited', 'Kiwi', 'general', '{}'),

  ('Aditya Birla Health Insurance Co. Ltd.', 'Aditya Birla Health', 'health', '{"ABHI","Aditya Birla"}'),
  ('Care Health Insurance Ltd.', 'Care Health', 'health', '{"Care","Religare Health","Religare Health Insurance Co. Ltd.","Religare"}'),
  ('Galaxy Health Insurance Company Limited', 'Galaxy Health', 'health', '{"Galaxy","Galaxy Health and Allied Insurance Co. Ltd"}'),
  ('Narayana Health Insurance Ltd.', 'Narayana Health', 'health', '{"Narayana"}'),
  ('ManipalCigna Health Insurance Company Limited', 'ManipalCigna', 'health', '{"Cigna","Manipal Cigna","CignaTTK"}'),
  ('Niva Bupa Health Insurance Co Ltd.', 'Niva Bupa', 'health', '{"Max Bupa","Bupa"}'),
  ('Prudential HCL Health Insurance Limited', 'Prudential HCL', 'health', '{"HCL Health","Prudential HCL Health"}'),
  ('Star Health & Allied Insurance Co. Ltd.', 'Star Health', 'health', '{"Star","Star Health and Allied Insurance Company Limited"}')
-- On the fold, not on the literal name: 0035 wrote "Niva Bupa Health Insurance
-- Company Limited" where the register says "Niva Bupa Health Insurance Co Ltd."
-- Those are the same company and fold to the same key, so conflicting on
-- legal_name would try to insert a second row and hit the fold index instead.
on conflict (fold_key) do update
  set legal_name = excluded.legal_name,
      short_name = excluded.short_name,
      category   = excluded.category,
      aliases    = excluded.aliases,
      active     = true;

insert into tpas (legal_name, short_name, irdai_registration, aliases) values
  ('Medi Assist Insurance TPA Private Limited', 'Medi Assist', '003', '{"MediAssist","Medi-Assist"}'),
  ('MDIndia Health Insurance TPA Private Limited', 'MDIndia', '005', '{"MD India"}'),
  ('Paramount Health Services & Insurance TPA Private Limited', 'Paramount', '006', '{"Paramount Health"}'),
  ('Heritage Health Insurance TPA Private Limited', 'Heritage Health', '008', '{"Heritage"}'),
  ('Family Health Plan Insurance TPA Limited', 'FHPL', '013', '{"Family Health Plan"}'),
  ('Vidal Health Insurance TPA Private Limited', 'Vidal Health', '016', '{"Vidal","TTK Healthcare"}'),
  ('Volo Health Insurance TPA Pvt. Ltd.', 'Volo Health', '018', '{"Volo","East West Assist","East West Assist Insurance TPA Private Limited"}'),
  ('Medsave Health Insurance TPA Limited', 'Medsave', '019', '{"Medsave Health"}'),
  ('Genins India Insurance TPA Limited', 'Genins', '020', '{"Genins India"}'),
  ('Health India Insurance TPA Services Private Limited', 'Health India', '022', '{}'),
  ('Good Health Insurance TPA Limited', 'Good Health', '023', '{}'),
  ('Park Mediclaim Insurance TPA Private Limited', 'Park Mediclaim', '025', '{"Park"}'),
  ('Health Assist Insurance TPA Pvt. Ltd.', 'Health Assist', '026', '{"Safeway","Safeway Insurance TPA Pvt. Ltd."}'),
  ('Ericson Insurance TPA Private Limited', 'Ericson', '035', '{}'),
  ('Health Insurance TPA of India Limited', 'HITPA', '036', '{"Health Insurance TPA of India"}'),
  ('Link-K Insurance TPA Private Limited', 'Link-K', '038', '{"Link K"}'),
  ('AKNA Health Insurance TPA Private Limited', 'AKNA Health', null, '{"AKNA"}')
on conflict (fold_key) do update
  set legal_name         = excluded.legal_name,
      short_name         = excluded.short_name,
      irdai_registration = excluded.irdai_registration,
      aliases            = excluded.aliases,
      active             = true;

-- --------------------------------------------------------------------------
-- 3. Re-resolve the deals that pointed at a name we have since corrected.
--
-- A policy naming "Reliance General" now resolves to IndusInd through the
-- alias. The stored text is left alone — it is what the schedule says.
-- --------------------------------------------------------------------------
update policies p
   set insurer_id = i.id
  from insurers i
 where p.insurer_name is not null
   and (p.insurer_id is null or p.insurer_id <> i.id)
   and exists (
     select 1 from unnest(i.aliases || i.legal_name || i.short_name) a
      where app.fold_party_name(a) = app.fold_party_name(p.insurer_name)
   );

update policies p
   set tpa_id = t.id
  from tpas t
 where p.tpa_name is not null
   and (p.tpa_id is null or p.tpa_id <> t.id)
   and exists (
     select 1 from unnest(t.aliases || t.legal_name || t.short_name) a
      where app.fold_party_name(a) = app.fold_party_name(p.tpa_name)
   );
