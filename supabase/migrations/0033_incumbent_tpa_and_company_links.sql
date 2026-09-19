-- ════════════════════════════════════════════════════════════════════════════
-- 0033 — the TPA on the expiring programme, and where a company lives online.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. The incumbent TPA.
--
-- Every RFQ asks who administers the claims, and it is stated on every policy
-- schedule — TATA AIG calls it the Claims Administrator, ICICI Lombard names
-- the TPA in the schedule header. Carrying the insurer and the broker but not
-- the TPA meant the one question an underwriter always asks had to be chased
-- by email.
-- --------------------------------------------------------------------------
alter table policies add column tpa_name text;

comment on column policies.tpa_name is
  'Who administered claims on the expiring policy. Stated on the schedule, asked for in every RFQ. Null where the insurer administers claims in-house.';

-- --------------------------------------------------------------------------
-- 2. Where a company can be looked up.
--
-- Not verified data and not used to compute anything. A website and a LinkedIn
-- page are how a person checks they are quoting the company they think they
-- are, and the LinkedIn headcount band is a sanity check against the lives on
-- the roster — self-reported and global, so it sits beside that figure as a
-- comparison rather than anywhere a number is derived from it.
-- --------------------------------------------------------------------------
alter table customers
  add column website_url text,
  add column linkedin_url text,

  -- Cheap shape checks. Not validation of whether the page exists — that is
  -- the user's judgement — but enough that a pasted phone number or a bare
  -- company name does not end up in a field the screen renders as a link.
  add constraint customers_website_is_a_url check (
    website_url is null or website_url ~* '^https?://[^\s/$.?#].[^\s]*$'
  ),
  add constraint customers_linkedin_is_a_linkedin_url check (
    linkedin_url is null or linkedin_url ~* '^https?://([a-z0-9-]+\.)?linkedin\.com/.+$'
  );

comment on column customers.website_url is
  'The company website. Reference only — nothing is fetched from it.';
comment on column customers.linkedin_url is
  'The company LinkedIn page. Reference only: the headcount shown there is self-reported and global, so it is displayed beside the roster figure for comparison and never used as a number.';
