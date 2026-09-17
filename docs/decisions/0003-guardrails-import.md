# 0003 — Importing the guardrails workbook

**Status:** accepted (M0)
**Relates to:** ARCHITECTURE.md §4.1, §4.3

§4.3 says to import each sheet "as a DB table with the same name and columns",
and that these rules are "not to be re-derived". Three things in the workbook
make the literal instruction impossible or lossy. Each is resolved below in the
direction that preserves the source, because the live rater depends on it.

## 1. `sku_coverage` is stored long, not wide

The sheet has 69 columns and **cannot be created as a table at all**: it carries
`sum_insured` twice — once as a SKU attribute (column 7) and once as
`benefit_key` #19 (column 30). Postgres has no way to represent that.

It is therefore stored as `(insurer_sku_id, benefit_key, value)`, 1,440 × 58 =
83,520 rows. This also matches §4.1's own prescription — "one `benefit_catalogue`

- one `policy_terms` value table (keyed by `benefit_key`)" — and avoids making
  `30_day_year_waiting_period` a permanently double-quoted identifier, since the
  benefit key becomes a value rather than an identifier.

No data is lost: the eleven SKU attribute columns on the sheet are identical to
`sku_pricing`'s and live there, joined on `insurer_sku_id`.

If the Admin CRUD console later wants the rater's native grid, that is a
generated wide view over this table, not a second source of truth.

## 2. Sentinels in numeric columns are preserved verbatim

Several numeric-looking columns carry non-numeric sentinels:

| Column                                           | Sentinel  | Rows   |
| ------------------------------------------------ | --------- | ------ |
| `sku_pricing.per_life_rate`                      | `NA`      | 528    |
| `sku_pricing.base_rate`                          | `NA`      | 480    |
| `sku_pricing.copay_factor`                       | `n/a`     | 720    |
| `sku_pricing.copay_factor`                       | `NA`      | 160    |
| `sku_pricing.maternity_factor`                   | `MISSING` | 96     |
| `rate_base.base_rate`                            | `NA`      | 39     |
| `rate_factors.factor`                            | `NA`      | 8      |
| `insurer_member_age_windows.min_age` / `max_age` | `-`       | 2 each |

These are meaningful — an `NA` base rate pairs with `block_reason_code =
NO_BASE_RATE` — and `copay_factor` uses two different spellings across two
different row sets, a distinction we are not entitled to collapse.

So: the typed column holds the parsed number and is null for a sentinel, and
every reference table also carries `source_row jsonb` with the sheet row exactly
as written. §4.3 holds literally, and any parsing decision stays reversible
without re-importing.

The importer throws on an _unknown_ non-numeric value rather than nulling it, so
a new data problem fails the import instead of silently skewing plan matching.

## 3. Four columns are prose, and are typed `text`

Not sentinels — these columns simply are not numbers:

- `insurer_guardrails.max_parent_employee_ratio` — `1:1.4`, `1:1.5`, `not applicable`
- `insurer_guardrails.min_lives_for_premium` — `E 15; ESC 15; ESCP 25` for one insurer
- `insurer_family_guardrails.premium_floor` — `charged on min 15 lives`, `min ₹100,000`, `-`
- `insurer_family_guardrails.policy_max_age` — `not offered`

**Resolved.** The insurer is Zurich Kotak, and the reading is:
`min_lives_for_premium` is resolved per `family_definition` _before_ the formula
is applied — 15 for E and ESC, 25 for ESCP. The rate itself stays per-life; only
the lives floor varies. So the formula is unchanged, and M3 looks the floor up
by family rather than treating it as one number per insurer.

The three shapes the floor takes across the panel are also by design, confirmed,
and all three must be implemented:

| Shape                               | Insurers                                                                          | Behaviour                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| A lives floor                       | Bajaj General, ICICI Lombard, Magma, Narayana Health (15); Liberty, TATA AIG (25) | Premium is charged on at least this many lives            |
| A premium floor                     | ABHI (₹100,000), Niva Bupa (₹75,000)                                              | No lives floor; the premium simply cannot fall below this |
| A lives floor that varies by family | Zurich Kotak (E 15; ESC 15; ESCP 25)                                              | As above, resolved per family definition                  |

## Row counts

§4.3's counts are header-inclusive; every sheet has exactly one fewer data row
than quoted (1,440 not 1,441; 58 benefits not 59; and so on). The importer
asserts the actual counts and refuses to run if they change.

## Verified, not assumed

The importer checks on every run that `benefit_catalogue.benefit_key` is exactly
the 58 `sku_coverage` benefit columns, in order, and fails if they diverge.
§4.1 makes that alignment the foundation of the extraction targets, RFQ terms
and the customer comparison table, so it is worth an assertion rather than an
assumption. It currently holds exactly.

## Enums

`enums` is imported as a lookup table (`ref_enums`) with composite foreign keys
from the coded columns, not as native Postgres enum types: §4.3 makes this
admin-editable reference data, and a native enum would need a schema migration
to change. Every enum-governed column in the workbook validates clean against
it today.

`rate_factors.dimension`/`option` are deliberately _not_ constrained — the
`enums` sheet does not cover them, and their option values legitimately differ
in form from the SKU-level option columns.

## Versioning

Not implemented, per the M0 decision that Admins edit pre-approved SKUs rather
than quote-level calculations. Reproducibility of historical results does not
depend on it: `plan_matches.guardrail_evaluation` stores the full rule trace,
and `burn_calculations` stores its own percentages per row (§10). Reference-data
edits are captured in `audit_log`. If Admins ever need to edit rates that
historical quotes were derived from, revisit this — effective-dating is much
cheaper to add before M3 than after.
