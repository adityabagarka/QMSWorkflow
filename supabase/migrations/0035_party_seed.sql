-- ════════════════════════════════════════════════════════════════════════════
-- 0035 — a starting list of insurers, TPAs and brokers.
--
-- ⚠ NEEDS REVIEW. These names were written from working knowledge, not read
-- from the register: the environment this was built in cannot reach
-- irdai.gov.in. `npm run db:import-parties` takes the IRDAI spreadsheets and
-- is the authoritative path — it corrects names, adds registration numbers and
-- deactivates anyone no longer registered.
--
-- Seeded anyway rather than left empty, because an empty dropdown is worse than
-- one somebody has to correct: with a list the shape is visible and the errors
-- are findable, and `on conflict do nothing` means the import can only improve
-- on this.
--
-- No registration numbers here. A registration number is a fact about a
-- regulated entity and a plausible-looking invented one would be worse than a
-- blank — this is the same rule the policy reader follows about clauses.
-- ════════════════════════════════════════════════════════════════════════════

insert into insurers (legal_name, short_name, category, aliases) values
  -- Public sector general insurers
  ('The New India Assurance Company Limited', 'New India Assurance', 'general', '{"New India","NIA"}'),
  ('United India Insurance Company Limited', 'United India', 'general', '{"UIIC"}'),
  ('The Oriental Insurance Company Limited', 'Oriental Insurance', 'general', '{"Oriental","OICL"}'),
  ('National Insurance Company Limited', 'National Insurance', 'general', '{"NIC"}'),

  -- Private general insurers
  ('Bajaj Allianz General Insurance Company Limited', 'Bajaj Allianz', 'general', '{"Bajaj","BAGIC"}'),
  ('ICICI Lombard General Insurance Company Limited', 'ICICI Lombard', 'general', '{"Lombard","ILGIC"}'),
  ('HDFC ERGO General Insurance Company Limited', 'HDFC ERGO', 'general', '{"HDFC Ergo","Ergo"}'),
  ('Tata AIG General Insurance Company Limited', 'Tata AIG', 'general', '{"TATA AIG","AIG"}'),
  ('Reliance General Insurance Company Limited', 'Reliance General', 'general', '{"Reliance","RGICL"}'),
  ('IFFCO Tokio General Insurance Company Limited', 'IFFCO Tokio', 'general', '{"IFFCO","Tokio"}'),
  ('Cholamandalam MS General Insurance Company Limited', 'Chola MS', 'general', '{"Cholamandalam","Chola"}'),
  ('Future Generali India Insurance Company Limited', 'Future Generali', 'general', '{"Generali","FGII"}'),
  ('Royal Sundaram General Insurance Company Limited', 'Royal Sundaram', 'general', '{"Royal Sundram"}'),
  ('SBI General Insurance Company Limited', 'SBI General', 'general', '{"SBI"}'),
  ('Universal Sompo General Insurance Company Limited', 'Universal Sompo', 'general', '{"Sompo"}'),
  ('Shriram General Insurance Company Limited', 'Shriram General', 'general', '{"Shriram"}'),
  ('Magma General Insurance Limited', 'Magma', 'general', '{"Magma HDI"}'),
  ('Liberty General Insurance Limited', 'Liberty General', 'general', '{"Liberty","Liberty Videocon"}'),
  ('Zurich Kotak General Insurance Company (India) Limited', 'Zurich Kotak', 'general', '{"Kotak General","Kotak Mahindra General"}'),
  ('Raheja QBE General Insurance Company Limited', 'Raheja QBE', 'general', '{"QBE"}'),
  ('Go Digit General Insurance Limited', 'Go Digit', 'general', '{"Digit"}'),
  ('Acko General Insurance Limited', 'Acko', 'general', '{"ACKO"}'),
  ('Navi General Insurance Limited', 'Navi General', 'general', '{"Navi"}'),
  ('Zuno General Insurance Limited', 'Zuno', 'general', '{"Edelweiss General","Edelweiss"}'),
  ('Kshema General Insurance Limited', 'Kshema', 'general', '{}'),
  ('Agriculture Insurance Company of India Limited', 'AIC', 'general', '{"Agriculture Insurance"}'),

  -- Standalone health insurers (SAHI)
  ('Star Health and Allied Insurance Company Limited', 'Star Health', 'health', '{"Star"}'),
  ('Niva Bupa Health Insurance Company Limited', 'Niva Bupa', 'health', '{"Max Bupa","Bupa"}'),
  ('Care Health Insurance Limited', 'Care Health', 'health', '{"Care","Religare Health","Religare"}'),
  ('ManipalCigna Health Insurance Company Limited', 'ManipalCigna', 'health', '{"Cigna","Manipal Cigna","CignaTTK"}'),
  ('Aditya Birla Health Insurance Company Limited', 'Aditya Birla Health', 'health', '{"ABHI","Aditya Birla"}'),
  ('Narayana Health Insurance Limited', 'Narayana Health', 'health', '{"Narayana"}'),
  ('Galaxy Health and Allied Insurance Company Limited', 'Galaxy Health', 'health', '{"Galaxy"}')
on conflict (legal_name) do nothing;

insert into tpas (legal_name, short_name, aliases) values
  ('Medi Assist Insurance TPA Private Limited', 'Medi Assist', '{"MediAssist","Medi-Assist"}'),
  ('Paramount Health Services & Insurance TPA Private Limited', 'Paramount', '{"Paramount Health"}'),
  ('MDIndia Health Insurance TPA Private Limited', 'MDIndia', '{"MD India"}'),
  ('Family Health Plan Insurance TPA Limited', 'FHPL', '{"Family Health Plan"}'),
  ('Vidal Health Insurance TPA Private Limited', 'Vidal Health', '{"Vidal","TTK Healthcare"}'),
  ('Heritage Health Insurance TPA Private Limited', 'Heritage Health', '{"Heritage"}'),
  ('Raksha Health Insurance TPA Private Limited', 'Raksha', '{"Raksha TPA"}'),
  ('Health India Insurance TPA Services Private Limited', 'Health India', '{}'),
  ('Ericson Insurance TPA Private Limited', 'Ericson', '{}'),
  ('Good Health Insurance TPA Limited', 'Good Health', '{}'),
  ('Safeway Insurance TPA Private Limited', 'Safeway', '{}'),
  ('Park Mediclaim Insurance TPA Private Limited', 'Park Mediclaim', '{"Park"}'),
  ('East West Assist Insurance TPA Private Limited', 'East West Assist', '{"East West"}'),
  ('Genins India Insurance TPA Limited', 'Genins', '{}'),
  ('Grand Insurance TPA Private Limited', 'Grand', '{}'),
  ('Happy Insurance TPA Services Private Limited', 'Happy', '{}'),
  ('Medvantage Insurance TPA Private Limited', 'Medvantage', '{}'),
  ('Vision Digital Insurance TPA Private Limited', 'Vision Digital', '{}'),
  ('Alankit Insurance TPA Limited', 'Alankit', '{}'),
  ('Rothshield Insurance TPA Limited', 'Rothshield', '{}'),
  ('Volo Health Insurance TPA Private Limited', 'Volo Health', '{"Volo"}')
on conflict (legal_name) do nothing;

-- Brokers we actually meet on a rollover, marked 'listed' so they are offered.
-- Everything else arrives through `app.resolve_broker` as 'seen' and is
-- promoted by use.
insert into brokers (legal_name, short_name, status, aliases) values
  ('Plum Benefits Insurance Brokers Private Limited', 'Plum', 'listed', '{"Plum Benefits","Plum Insurance"}'),
  ('Marsh India Insurance Brokers Private Limited', 'Marsh', 'listed', '{"Marsh India","Marsh McLennan"}'),
  ('Aon India Insurance Brokers Private Limited', 'Aon', 'listed', '{"Aon India"}'),
  ('WTW India Insurance Brokers Private Limited', 'WTW', 'listed', '{"Willis Towers Watson","Willis"}'),
  ('Howden Insurance Brokers India Private Limited', 'Howden', 'listed', '{"Howden India"}'),
  ('Prudent Insurance Brokers Private Limited', 'Prudent', 'listed', '{"Prudent Brokers"}'),
  ('Anand Rathi Insurance Brokers Limited', 'Anand Rathi', 'listed', '{}'),
  ('Alliance Insurance Brokers Private Limited', 'Alliance', 'listed', '{}'),
  ('India Insure Risk Management & Insurance Broking Services Private Limited', 'India Insure', 'listed', '{}'),
  ('Global Insurance Brokers Private Limited', 'Global Insurance Brokers', 'listed', '{}'),
  ('J. B. Boda Insurance & Reinsurance Brokers Private Limited', 'JB Boda', 'listed', '{"J B Boda","Boda"}'),
  ('Unison Insurance Broking Services Private Limited', 'Unison', 'listed', '{}'),
  ('SecureNow Insurance Broker Private Limited', 'SecureNow', 'listed', '{"Secure Now"}'),
  ('Mahindra Insurance Brokers Limited', 'Mahindra Insurance Brokers', 'listed', '{"MIBL"}'),
  ('Bajaj Capital Insurance Broking Limited', 'Bajaj Capital', 'listed', '{}'),
  ('Policybazaar Insurance Brokers Private Limited', 'Policybazaar', 'listed', '{"Policy Bazaar","PB"}'),
  ('Emedlife Insurance Broking Services Limited', 'Emedlife', 'listed', '{}'),
  ('Toyota Tsusho Insurance Broker India Private Limited', 'Toyota Tsusho', 'listed', '{}'),
  ('Salasar Services Insurance Brokers Private Limited', 'Salasar', 'listed', '{}'),
  ('Ideal Insurance Brokers Private Limited', 'Ideal Insurance', 'listed', '{}')
on conflict (legal_name) do nothing;
