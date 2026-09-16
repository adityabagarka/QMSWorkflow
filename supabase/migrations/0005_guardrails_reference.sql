-- 0005_guardrails_reference.sql
-- Guardrails engine reference data, imported from
-- fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx.
-- Reference: ARCHITECTURE.md §4.1, §4.3.
--
-- These are admin-editable reference data, not application code (§4.3): the
-- Admin role's "configure pre-approved plans" permission is CRUD here.
--
-- Values are imported verbatim. Where the workbook is internally inconsistent
-- (see docs/decisions/0003-guardrails-import.md) the inconsistency is preserved,
-- because the live rater depends on it; §4.3 is explicit that these rules are
-- not to be re-derived.

-- --------------------------------------------------------------------------
-- enums: allowed values for every coded field.
--
-- A lookup table rather than native Postgres enum types: §4.3 makes this
-- admin-editable, and a native enum would need a schema migration to change.
-- --------------------------------------------------------------------------
create table ref_enums (
  enum_name     text not null,
  allowed_value text not null,
  primary key (enum_name, allowed_value)
);

-- --------------------------------------------------------------------------
-- benefit_catalogue: THE canonical schema (§4.1).
--
-- 58 benefit keys, which are exactly the 58 benefit columns of the sku_coverage
-- sheet, in order (verified against the workbook). Every extraction target,
-- policy term, RFQ column and comparison-table row references benefit_key.
-- Do not create a second field list for any of these (CLAUDE.md).
-- --------------------------------------------------------------------------
create table benefit_catalogue (
  benefit_key   text primary key,
  display_order integer not null unique,
  section       text not null,
  benefit_label text not null
);

-- --------------------------------------------------------------------------
-- sku_pricing: one row per SKU, rate build-up and eligibility.
-- Natural key insurer_sku_id (per the workbook's own _schema sheet).
-- --------------------------------------------------------------------------
create table sku_pricing (
  insurer_sku_id         text primary key,
  sku_name               text not null,
  insurer                text not null,
  insurer_code           text not null,
  plan                   text,
  family_definition      text not null,
  sum_insured            numeric not null,
  maternity_option       text not null,
  room_rent_option       text not null,
  parental_copay_option  text not null,
  maternity_code         text,
  room_rent_code         text,
  parental_copay_code    text,
  is_sellable            boolean not null,
  block_reason_code      text,
  block_reason           text,
  loading_method         text,
  base_rate              numeric,
  maternity_factor       numeric,
  room_rent_factor       numeric,
  copay_factor           numeric,
  per_life_rate          numeric,
  commission_pct         numeric,
  xp_share_pct           numeric,
  max_commission_pct     numeric,

  -- Coded columns are validated against ref_enums rather than a CHECK list, so
  -- that an Admin edit to the enums reference data takes effect without a
  -- migration. The constant generated columns exist only to give the composite
  -- foreign key its left-hand side.
  family_definition_enum text generated always as ('family_definition') stored,
  sum_insured_enum       text generated always as ('sum_insured') stored,
  sum_insured_text       text generated always as (trim_scale(sum_insured)::text) stored,
  maternity_option_enum  text generated always as ('maternity_option') stored,
  room_rent_option_enum  text generated always as ('room_rent_option') stored,
  parental_copay_option_enum text generated always as ('parental_copay_option') stored,
  loading_method_enum    text generated always as ('loading_method') stored,

  constraint sku_pricing_family_definition_fk
    foreign key (family_definition_enum, family_definition) references ref_enums (enum_name, allowed_value),
  constraint sku_pricing_sum_insured_fk
    foreign key (sum_insured_enum, sum_insured_text) references ref_enums (enum_name, allowed_value),
  constraint sku_pricing_maternity_option_fk
    foreign key (maternity_option_enum, maternity_option) references ref_enums (enum_name, allowed_value),
  constraint sku_pricing_room_rent_option_fk
    foreign key (room_rent_option_enum, room_rent_option) references ref_enums (enum_name, allowed_value),
  constraint sku_pricing_parental_copay_option_fk
    foreign key (parental_copay_option_enum, parental_copay_option) references ref_enums (enum_name, allowed_value),
  constraint sku_pricing_loading_method_fk
    foreign key (loading_method_enum, loading_method) references ref_enums (enum_name, allowed_value)
);

create index sku_pricing_insurer_idx on sku_pricing (insurer, family_definition, sum_insured);
create index sku_pricing_sellable_idx on sku_pricing (is_sellable) where is_sellable;

-- --------------------------------------------------------------------------
-- sku_coverage: coverage terms per SKU, keyed by benefit_key.
--
-- DEVIATION from §4.3's "same name and columns", forced and deliberate — see
-- docs/decisions/0003-guardrails-import.md. The sheet is wide (69 columns) and
-- cannot be created as a table at all: it carries `sum_insured` twice (once as
-- a SKU attribute, once as benefit_key #19). Storing it long, keyed by
-- benefit_key, resolves that, matches §4.1's "one policy_terms-shaped value
-- table keyed by benefit_key", and avoids making `30_day_year_waiting_period`
-- a permanently quoted identifier. The SKU attribute columns are not lost:
-- they are identical to sku_pricing's and live there.
-- --------------------------------------------------------------------------
create table sku_coverage (
  insurer_sku_id text not null references sku_pricing (insurer_sku_id) on delete cascade,
  benefit_key    text not null references benefit_catalogue (benefit_key) on delete restrict,
  value          text,
  primary key (insurer_sku_id, benefit_key)
);

create index sku_coverage_benefit_key_idx on sku_coverage (benefit_key);

-- --------------------------------------------------------------------------
-- insurer_guardrails: per-insurer size, age, ratio and commercial limits.
-- --------------------------------------------------------------------------
create table insurer_guardrails (
  insurer                  text primary key,
  insurer_code             text not null unique,
  families_offered         text,
  families_not_offered     text,
  min_employees            integer,
  max_employees            integer,
  max_lives                integer,
  -- Prose in the workbook, e.g. 'E 15; ESC 15; ESCP 25' for one insurer.
  -- Typed as text so the source is representable; M3 parses it per family.
  min_lives_for_premium    text,
  min_premium              numeric,
  -- Expressed as a ratio string ('1:1.4') or 'not applicable', not a scalar.
  max_parent_employee_ratio text,
  employee_spouse_max_age  integer,
  policy_max_age_e         integer,
  policy_max_age_esc       integer,
  policy_max_age_escp      integer,
  family_conditions        text,
  maternity_condition      text,
  room_rent_options        text,
  maternity_limits         text,
  commission_pct           numeric,
  xp_share_pct             numeric,
  max_commission_pct       numeric
);

comment on column insurer_guardrails.min_lives_for_premium is
  'Feeds the §4.3 premium formula MAX(per_life_rate * MAX(rated_lives, min_lives_for_premium), min_premium). NOTE: the formula treats this as a scalar, but one insurer states it per family ("E 15; ESC 15; ESCP 25"). M3 must resolve it per family_definition before applying the formula — flagged in docs/decisions/0003-guardrails-import.md.';

-- --------------------------------------------------------------------------
-- insurer_family_guardrails: per-insurer, per-family-definition eligibility.
-- --------------------------------------------------------------------------
create table insurer_family_guardrails (
  insurer               text not null references insurer_guardrails (insurer) on delete cascade,
  family_definition     text not null,
  is_offered            boolean not null,
  not_offered_reason    text,
  conditions            text,
  -- Prose: '-', 'min Rs 100,000', 'charged on min 15 lives'.
  premium_floor         text,
  sum_insured_available text,
  policy_max_age        text,   -- may read 'not offered'
  sellable_sku_count    integer,
  primary key (insurer, family_definition),

  family_definition_enum text generated always as ('family_definition') stored,
  constraint insurer_family_guardrails_family_definition_fk
    foreign key (family_definition_enum, family_definition) references ref_enums (enum_name, allowed_value)
);

-- --------------------------------------------------------------------------
-- insurer_member_age_windows: age window per insurer per member type.
-- member_type is validated against the `relationship` enum (the workbook uses
-- the same four values under a different name).
-- --------------------------------------------------------------------------
create table insurer_member_age_windows (
  insurer      text not null references insurer_guardrails (insurer) on delete cascade,
  member_type  text not null,
  min_age      integer,
  max_age      integer,
  is_rateable  boolean not null,
  primary key (insurer, member_type),

  member_type_enum text generated always as ('relationship') stored,
  constraint insurer_member_age_windows_member_type_fk
    foreign key (member_type_enum, member_type) references ref_enums (enum_name, allowed_value)
);

-- --------------------------------------------------------------------------
-- member_data_rules: the full A-F rule set.
--
-- This table IS the member-data validation engine spec (§4.3, §9). M3
-- implements each rule_id literally, in the stage order given. Stored as
-- reference data so the rules are visible and admin-editable rather than
-- buried in code.
-- --------------------------------------------------------------------------
create table member_data_rules (
  rule_id    text primary key,
  stage      text not null,
  rule_name  text not null,
  logic      text not null,
  applies_to text,
  severity   text,
  action     text
);

comment on column member_data_rules.logic is
  'Implement literally (§4.3). Notably C-01 computes age with a 365-day divisor, not calendar-anniversary logic — deliberate, matches the live rater, do not "fix".';

-- --------------------------------------------------------------------------
-- appetite: long format, is_acceptable = false means the insurer declines and
-- is removed from plan matching entirely (rules E-08, E-09).
-- --------------------------------------------------------------------------
create table appetite_industry (
  industry      text not null,
  insurer       text not null references insurer_guardrails (insurer) on delete cascade,
  is_acceptable boolean not null,
  primary key (industry, insurer)
);

create table appetite_entity (
  entity_type   text not null,
  insurer       text not null references insurer_guardrails (insurer) on delete cascade,
  is_acceptable boolean not null,
  primary key (entity_type, insurer)
);

-- --------------------------------------------------------------------------
-- rate_base / rate_factors: inputs to the §4.3 rate formulae.
-- --------------------------------------------------------------------------
create table rate_base (
  insurer           text not null references insurer_guardrails (insurer) on delete cascade,
  insurer_code      text not null,
  family_definition text not null,
  sum_insured       numeric not null,
  base_rate         numeric,   -- null where the sheet reads 'NA' (no rate offered)
  primary key (insurer, family_definition, sum_insured)
);

create table rate_factors (
  insurer      text not null references insurer_guardrails (insurer) on delete cascade,
  insurer_code text not null,
  dimension    text not null,
  option       text not null,
  factor       numeric,   -- null where the sheet reads 'NA'
  primary key (insurer, dimension, option)
);

comment on table rate_factors is
  'Not validated against ref_enums: the workbook''s `enums` sheet does not cover the dimension/option pairs used here, and the option values legitimately differ in form from the SKU-level option columns. Preserved verbatim per §4.3.';

-- --------------------------------------------------------------------------
-- Verbatim source rows.
--
-- Several numeric-looking columns carry sentinels ('NA', 'n/a', 'MISSING',
-- '-') that are meaningful to the rater: 'NA' base_rate pairs with
-- block_reason_code NO_BASE_RATE, and sku_pricing.copay_factor uses both 'NA'
-- (160 rows) and 'n/a' (720 rows), a distinction we are not entitled to
-- collapse. The typed columns above hold the parsed value and are null for
-- these; source_row holds the sheet cell exactly as written, so §4.3's
-- "import as-is, do not re-derive" holds literally and any parsing decision
-- stays reversible without a re-import.
-- --------------------------------------------------------------------------
alter table sku_pricing add column source_row jsonb not null default '{}'::jsonb;
alter table insurer_guardrails add column source_row jsonb not null default '{}'::jsonb;
alter table insurer_family_guardrails add column source_row jsonb not null default '{}'::jsonb;
alter table insurer_member_age_windows add column source_row jsonb not null default '{}'::jsonb;
alter table member_data_rules add column source_row jsonb not null default '{}'::jsonb;
alter table appetite_industry add column source_row jsonb not null default '{}'::jsonb;
alter table appetite_entity add column source_row jsonb not null default '{}'::jsonb;
alter table rate_base add column source_row jsonb not null default '{}'::jsonb;
alter table rate_factors add column source_row jsonb not null default '{}'::jsonb;
