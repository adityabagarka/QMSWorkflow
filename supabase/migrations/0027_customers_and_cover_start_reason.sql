-- ════════════════════════════════════════════════════════════════════════════
-- 0027 — a customer is an entity, and a shifted cover start says why.
--
-- Two changes, both settled in ADR 0011 before the documents-first flow is
-- built, because both are far cheaper now than retrofitted behind screens.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Customers.
--
-- The company facts lived on `cases`: customer_name, gstin, entity_type,
-- industry, location, date_of_incorporation. That models a company as something
-- that happens once per deal, which is wrong in two ways that matter.
--
-- It makes "pick an existing client and go straight to the deal" impossible,
-- because there is no client to pick — only a string somebody typed on a
-- previous case. And it makes the renewal flow a second implementation rather
-- than the same one: a renewal is a new deal against a customer we already
-- know, which requires the customer to outlive the deal.
--
-- One company, many deals over time. The company section of deal setup belongs
-- to the customer; the programme section belongs to the deal.
-- --------------------------------------------------------------------------
create table customers (
  id                    uuid primary key default gen_random_uuid(),

  -- The anchor, when we have it. Nullable because a deal often starts from a
  -- phone call before any document exists (ADR 0011 rule 6), and unique because
  -- a GSTIN identifies exactly one taxpayer — which is what makes it the thing
  -- that stops two RMs creating the same client twice.
  gstin                 text unique,

  legal_name            text not null,
  entity_type           text,
  industry              text,
  location              text,
  date_of_incorporation date,

  created_by            uuid references app_users (id) on delete restrict,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Stored as printed: GSTINs are uppercase alphanumeric, and a lookup that
  -- misses because somebody typed lowercase would silently create a duplicate,
  -- which is the one failure this table exists to prevent.
  constraint customers_gstin_upper check (gstin is null or gstin = upper(gstin)),
  constraint customers_legal_name_present check (length(trim(legal_name)) > 0)
);

comment on table customers is
  'A company Plum quotes for. Outlives any one deal: this year''s rollover and next year''s renewal are two cases against one customer (ADR 0011 rule 4).';
comment on column customers.gstin is
  'The GSTN taxpayer identifier, when known. Unique, so the same company cannot be created twice. Usually printed on the policy copy, so it is an extraction target as well as an input.';

create index customers_legal_name_idx on customers (lower(legal_name));

create trigger customers_touch before update on customers
  for each row execute function app.touch_updated_at();

-- --------------------------------------------------------------------------
-- 2. Point cases at customers, and move the company facts across.
-- --------------------------------------------------------------------------
alter table cases add column customer_id uuid references customers (id) on delete restrict;

-- Backfill. Existing cases carry the company inline, so each distinct company
-- becomes a customer and every case pointing at it is rewired.
--
-- Grouped by GSTIN where there is one and by name otherwise: two cases naming
-- the same GSTIN are the same company whatever the typed names say, which is
-- exactly the deduplication the new table is for.
with distinct_companies as (
  select
    coalesce(upper(nullif(trim(gstin), '')), 'name:' || lower(trim(customer_name))) as dedupe_key,
    min(upper(nullif(trim(gstin), '')))                                             as gstin,
    min(trim(customer_name))                                                        as legal_name,
    min(entity_type)                                                                as entity_type,
    min(industry)                                                                   as industry,
    min(location)                                                                   as location,
    min(date_of_incorporation)                                                      as date_of_incorporation,
    min(created_at)                                                                 as created_at
  from cases
  group by 1
),
inserted as (
  insert into customers (gstin, legal_name, entity_type, industry, location, date_of_incorporation, created_at)
  select gstin, legal_name, entity_type, industry, location, date_of_incorporation, created_at
  from distinct_companies
  returning id, gstin, legal_name
)
update cases c
set customer_id = i.id
from inserted i
where i.gstin is not distinct from upper(nullif(trim(c.gstin), ''))
  and (i.gstin is not null or lower(i.legal_name) = lower(trim(c.customer_name)));

-- Every case must now have one. Enforced after the backfill rather than at
-- creation, so this migration cannot half-apply.
alter table cases alter column customer_id set not null;

create index cases_customer_idx on cases (customer_id);

-- The inline copies go. Keeping them would leave two places holding a company's
-- name — the exact duplication CLAUDE.md's canonical-schema rule forbids — and
-- they would disagree the first time one was edited.
alter table cases
  drop column customer_name,
  drop column gstin,
  drop column entity_type,
  drop column industry,
  drop column location,
  drop column date_of_incorporation;

-- --------------------------------------------------------------------------
-- 3. Row-level security on customers.
--
-- Readable by every active user, which is a deliberate departure from the span
-- model that governs cases (§15).
--
-- The reasoning: every column on this table is public-registry data. Legal
-- name, constitution, industry, principal place of business and date of
-- incorporation are all published on the GSTN portal and searchable by anyone.
-- There is nothing on the row to protect.
--
-- What IS confidential — the premium, the terms, the quotes, the claims — lives
-- on `cases` and its descendants, and the span model still governs every one of
-- them. An RM outside the span can see that Meridian Logistics is a customer;
-- they cannot see a single thing about the deal.
--
-- The alternative, scoping customers to the span too, would guarantee duplicate
-- customer records for the same company — two RMs, neither able to see the
-- other's, both creating one. That defeats the entire purpose of the table.
-- --------------------------------------------------------------------------
alter table customers enable row level security;

create policy customers_select on customers for select to authenticated
  using (app.is_active_user());

create policy customers_insert on customers for insert to authenticated
  with check (app.is_active_user());

create policy customers_update on customers for update to authenticated
  using (app.is_active_user()) with check (app.is_active_user());

-- Deleting a customer would orphan its deals, and `on delete restrict` above
-- refuses that anyway. Reserved to Super Admin for the case of a genuine
-- duplicate created before anyone quoted against it.
create policy customers_delete_super_admin on customers for delete to authenticated
  using (app.is_super_admin());

grant select, insert, update on customers to authenticated;
grant delete on customers to authenticated;

-- --------------------------------------------------------------------------
-- 4. Cover start: derived, overridable, and explained when overridden.
--
-- Cover starts the day after the expiring policy ends. That is what continuity
-- means, and it is the default.
--
-- It is not locked, because cover genuinely does start on another date — the
-- client shifts it, a gap gets accepted, the incumbent extends by a month. A
-- derived field that cannot be corrected is a field that will be wrong and have
-- no way of saying so.
--
-- But a shift is a fact about the customer worth keeping. Why a programme moved
-- is a behavioural signal — and once it is a free-text note nobody can count it.
-- So the reason is a vocabulary, with the note beside it rather than instead of
-- it.
--
-- `cover_start_derived_date` records what the derivation produced at the time.
-- It is what makes the constraint below possible on one table, and it also
-- means a later correction to the policy's expiry date does not silently turn a
-- deliberate override into an apparent mistake.
-- --------------------------------------------------------------------------
alter table cases
  add column cover_start_derived_date  date,
  add column cover_start_change_reason text,
  add column cover_start_change_note   text;

comment on column cases.cover_start_derived_date is
  'Expiring policy end date plus one day, as computed when the deal was set up. Kept so an override is still recognisable as one after the expiry date is corrected.';
comment on column cases.cover_start_change_reason is
  'Why cover does not start the day after expiry. A fixed vocabulary so the answer can be counted across deals, not prose.';

alter table cases add constraint cases_cover_start_reason_known check (
  cover_start_change_reason is null or cover_start_change_reason in (
    'client_requested_later',      -- the client asked to push inception out
    'client_requested_earlier',    -- brought forward, usually to align cover
    'gap_accepted',                -- the client knowingly ran uninsured
    'aligning_to_financial_year',  -- moved to sit with their FY
    'incumbent_extended',          -- the expiring policy was extended short-term
    'awaiting_member_data',        -- could not bind without the roster
    'negotiation_ongoing',         -- terms not agreed in time
    'other'                        -- anything else; the note carries it
  )
);

-- A shift must say why. Same shape as the review gate: the system refuses to
-- hold a state where something was decided and no reason was recorded.
alter table cases add constraint cases_cover_start_shift_explained check (
  cover_start_date is null
  or cover_start_derived_date is null
  or cover_start_date = cover_start_derived_date
  or cover_start_change_reason is not null
);

-- 'other' without a note says nothing at all, which is worse than no reason:
-- it looks answered.
alter table cases add constraint cases_cover_start_other_needs_note check (
  cover_start_change_reason is distinct from 'other'
  or length(trim(coalesce(cover_start_change_note, ''))) > 0
);
