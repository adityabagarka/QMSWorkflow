-- 0024_company_profile_fields.sql
-- The company facts the intake actually asks for, and the incumbent details the
-- deal summary shows.

-- --------------------------------------------------------------------------
-- Company profile.
--
-- GSTIN is the anchor: the legal name, principal place of business and
-- constitution come from the GSTN taxpayer record, so the policy is issued in
-- exactly the name the insurer underwrites rather than whatever someone typed.
-- --------------------------------------------------------------------------
alter table cases
  add column gstin text,
  add column location text,
  add column date_of_incorporation date;

comment on column cases.gstin is
  'Anchors the company profile. Legal name, location and constitution are read from the GSTN record against it.';
comment on column cases.date_of_incorporation is
  'Insurers read company age as a risk signal, so it is captured at intake rather than asked for later.';

create index cases_gstin_idx on cases (gstin) where gstin is not null;

-- --------------------------------------------------------------------------
-- Deal type.
--
-- Phase 1 builds rollovers only (§1), and renewals are explicitly out of scope
-- — but the deal summary is colour-coded by type, and a colour scheme that
-- cannot represent the second type is not a scheme. Widening the constraint
-- admits the value; it does not build the workflow.
-- --------------------------------------------------------------------------
alter table cases drop constraint cases_deal_type_phase1;
alter table cases add constraint cases_deal_type_known
  check (deal_type in ('rollover', 'renewal'));

-- --------------------------------------------------------------------------
-- The incumbent programme, as the summary block reports it.
--
-- The broker matters: on a rollover there is an incumbent broker being replaced,
-- and knowing who they are changes how the case is handled. §8 already lists
-- broker among the header fields read out of the policy copy; this is where it
-- lands.
-- --------------------------------------------------------------------------
alter table policies
  add column broker_name text,
  add column expiring_premium numeric;

comment on column policies.broker_name is
  'The incumbent broker on the expiring programme. Extracted from the policy copy (§8) or entered by hand.';
comment on column policies.expiring_premium is
  'Premium on the expiring programme, EXCLUDING GST. Every premium in this system excludes GST; it is stated once against the figure rather than repeated as helper text.';
