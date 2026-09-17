/**
 * Imports fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx into the guardrails
 * reference tables (ARCHITECTURE.md §4.3).
 *
 * Principles:
 *  - Values are imported verbatim. §4.3 is explicit that these rules are not to
 *    be re-derived, so where the workbook is internally inconsistent the
 *    inconsistency is preserved. Only identifiers are normalised, and only
 *    where Postgres forces it.
 *  - Idempotent: every sheet upserts on its natural key (taken from the
 *    workbook's own `_schema` sheet), so a corrected workbook can be re-imported
 *    without truncating tables that other rows reference.
 *  - Asserted: row counts and the benefit_catalogue <-> sku_coverage alignment
 *    are checked, because a silently short import would corrupt plan matching
 *    without failing anything.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import { withClient } from '../db';

const WORKBOOK = join(
  process.cwd(),
  'data',
  'reference',
  'fresh_rater_SKU_Guardrails_RATER_UPLOAD.xlsx',
);

/**
 * Expected data-row counts.
 *
 * §4.3 quotes these one higher across the board (1,441 / 59 / 10 / ...); those
 * figures count the header row. These are the actual data rows.
 */
const EXPECTED_ROWS: Record<string, number> = {
  sku_pricing: 1440,
  sku_coverage: 1440,
  benefit_catalogue: 58,
  insurer_guardrails: 9,
  insurer_family_guardrails: 27,
  insurer_member_age_windows: 36,
  member_data_rules: 37,
  appetite_industry: 414,
  appetite_entity: 81,
  rate_base: 135,
  rate_factors: 96,
  enums: 31,
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'result' in (value as object)) {
    return text((value as { result: unknown }).result);
  }
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Sentinels the workbook uses in otherwise-numeric columns. Each means "no
 * value", but they are NOT interchangeable to the rater — 'NA' base_rate pairs
 * with block_reason_code NO_BASE_RATE, and copay_factor uses 'NA' and 'n/a' in
 * different row sets. The typed column gets null; the verbatim spelling is kept
 * in source_row.
 */
const NUMERIC_SENTINELS = new Set(['na', 'n/a', 'missing', '-', 'nil', 'not applicable']);

/**
 * Parses a numeric cell. Known sentinels become null; anything else that is not
 * a number throws, so a genuinely new data problem fails the import rather than
 * silently becoming a null that would skew plan matching.
 */
function num(value: unknown, context?: string): number | null {
  const s = text(value);
  if (s === null) return null;
  if (NUMERIC_SENTINELS.has(s.toLowerCase())) return null;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) {
    throw new Error(
      `Unexpected non-numeric value ${JSON.stringify(s)}${context ? ` in ${context}` : ''}. ` +
        `If this is a new sentinel, add it to NUMERIC_SENTINELS deliberately — do not ` +
        `let it become a silent null.`,
    );
  }
  return n;
}

/** The verbatim sheet row, for source_row. Keys are the sheet's own headers. */
function sourceRow(row: Row): string {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.split(':').slice(1).join(':')] = text(value);
  }
  return JSON.stringify(out);
}

/** The workbook encodes booleans as 0/1. */
function bool(value: unknown): boolean | null {
  const s = text(value);
  if (s === null) return null;
  if (s === '1' || s.toLowerCase() === 'true') return true;
  if (s === '0' || s.toLowerCase() === 'false') return false;
  throw new Error(`Expected a 0/1 boolean, got ${JSON.stringify(s)}`);
}

/**
 * Renders a number the way Postgres renders trim_scale(numeric)::text, so that
 * sku_pricing.sum_insured matches its ref_enums row. Without this, 200000 and
 * "200000.0" would be two different enum values.
 */
function enumNumber(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : String(n);
}

function readSheet(workbook: ExcelJS.Workbook, name: string): Row[] {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Sheet ${name} is missing from the workbook`);

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? '').trim();
  });

  const rows: Row[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Row = {};
    let hasValue = false;
    // The sku_coverage sheet carries `sum_insured` twice — once as a SKU
    // attribute and once as benefit_key #19 — so columns are keyed positionally
    // and duplicates are disambiguated by index rather than by name.
    headers.forEach((header, index) => {
      const value = row.getCell(index + 1).value;
      record[`${index}:${header}`] = value;
      if (text(value) !== null) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

function column(rows: Row[], header: string, occurrence = 0): string {
  const keys = Object.keys(rows[0] ?? {}).filter((k) => k.split(':').slice(1).join(':') === header);
  const key = keys[occurrence];
  if (!key) throw new Error(`Column ${header} (occurrence ${occurrence}) not found`);
  return key;
}

async function upsert(
  client: Client,
  table: string,
  columns: string[],
  conflictKeys: string[],
  rows: unknown[][],
  /** When given, the verbatim sheet rows are stored alongside in source_row. */
  sourceRows?: Row[],
): Promise<void> {
  if (rows.length === 0) return;

  if (sourceRows) {
    if (sourceRows.length !== rows.length) {
      throw new Error(
        `source row count (${sourceRows.length}) does not match ${table} rows (${rows.length})`,
      );
    }
    columns = [...columns, 'source_row'];
    rows = rows.map((row, i) => [...row, sourceRow(sourceRows[i]!)]);
  }

  const updates = columns
    .filter((c) => !conflictKeys.includes(c))
    .map((c) => `${c} = excluded.${c}`);

  // Batched to keep parameter counts inside Postgres' 65,535 limit.
  const perStatement = Math.max(1, Math.floor(60000 / columns.length));

  for (let offset = 0; offset < rows.length; offset += perStatement) {
    const batch = rows.slice(offset, offset + perStatement);
    const params: unknown[] = [];
    const tuples = batch.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    await client.query(
      `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')}
       on conflict (${conflictKeys.join(', ')}) do ${
         updates.length > 0 ? `update set ${updates.join(', ')}` : 'nothing'
       }`,
      params,
    );
  }
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK);

  const sheets = Object.fromEntries(
    Object.keys(EXPECTED_ROWS).map((name) => [name, readSheet(workbook, name)]),
  ) as Record<string, Row[]>;

  // Fail before touching the database if the workbook is not the one we expect.
  for (const [name, expected] of Object.entries(EXPECTED_ROWS)) {
    const actual = sheets[name]!.length;
    if (actual !== expected) {
      throw new Error(
        `Sheet ${name} has ${actual} data rows, expected ${expected}. ` +
          `If the workbook was legitimately revised, update EXPECTED_ROWS in this script ` +
          `and say so in the commit message — a silent row-count change here would ` +
          `alter plan-matching results.`,
      );
    }
  }

  // §4.1's central claim, verified rather than assumed: the benefit_catalogue
  // keys ARE the sku_coverage benefit columns, in order.
  const coverage = sheets.sku_coverage!;
  const coverageKeys = Object.keys(coverage[0] ?? {});
  const benefitColumns = coverageKeys.slice(11);
  const catalogueKeys = sheets.benefit_catalogue!.map((r) =>
    text(r[column(sheets.benefit_catalogue!, 'benefit_key')]),
  );
  const benefitColumnNames = benefitColumns.map((k) => k.split(':').slice(1).join(':'));

  if (JSON.stringify(catalogueKeys) !== JSON.stringify(benefitColumnNames)) {
    throw new Error(
      'benefit_catalogue.benefit_key no longer matches the sku_coverage benefit columns. ' +
        'These must stay identical — §4.1 makes benefit_catalogue the single canonical ' +
        'schema for extraction targets, SKU coverage, RFQ terms and the comparison table.',
    );
  }

  await withClient(async (client) => {
    await client.query('begin');
    try {
      const c = (sheet: string, header: string, occurrence = 0) =>
        column(sheets[sheet]!, header, occurrence);

      // --- enums: first, everything else validates against it ----------------
      const enumRows = sheets.enums!;
      await upsert(
        client,
        'ref_enums',
        ['enum_name', 'allowed_value'],
        ['enum_name', 'allowed_value'],
        enumRows.map((r) => {
          const name = text(r[c('enums', 'enum_name')]);
          const raw = r[c('enums', 'allowed_value')];
          // Numeric enum values are normalised to Postgres' own numeric->text
          // rendering so the composite foreign keys in 0005 resolve.
          return [name, name === 'sum_insured' ? enumNumber(raw) : text(raw)];
        }),
      );

      // --- benefit_catalogue: the canonical schema ---------------------------
      await upsert(
        client,
        'benefit_catalogue',
        ['benefit_key', 'display_order', 'section', 'benefit_label'],
        ['benefit_key'],
        sheets.benefit_catalogue!.map((r) => [
          text(r[c('benefit_catalogue', 'benefit_key')]),
          num(r[c('benefit_catalogue', 'display_order')]),
          text(r[c('benefit_catalogue', 'section')]),
          text(r[c('benefit_catalogue', 'benefit_label')]),
        ]),
      );

      // --- insurer_guardrails: parent of every insurer-scoped table ----------
      await upsert(
        client,
        'insurer_guardrails',
        [
          'insurer',
          'insurer_code',
          'families_offered',
          'families_not_offered',
          'min_employees',
          'max_employees',
          'max_lives',
          'min_lives_for_premium',
          'min_premium',
          'max_parent_employee_ratio',
          'employee_spouse_max_age',
          'policy_max_age_e',
          'policy_max_age_esc',
          'policy_max_age_escp',
          'family_conditions',
          'maternity_condition',
          'room_rent_options',
          'maternity_limits',
          'commission_pct',
          'xp_share_pct',
          'max_commission_pct',
        ],
        ['insurer'],
        sheets.insurer_guardrails!.map((r) => [
          text(r[c('insurer_guardrails', 'insurer')]),
          text(r[c('insurer_guardrails', 'insurer_code')]),
          text(r[c('insurer_guardrails', 'families_offered')]),
          text(r[c('insurer_guardrails', 'families_not_offered')]),
          num(r[c('insurer_guardrails', 'min_employees')]),
          num(r[c('insurer_guardrails', 'max_employees')]),
          num(r[c('insurer_guardrails', 'max_lives')]),
          text(r[c('insurer_guardrails', 'min_lives_for_premium')]),
          num(r[c('insurer_guardrails', 'min_premium')]),
          text(r[c('insurer_guardrails', 'max_parent_employee_ratio')]),
          num(r[c('insurer_guardrails', 'employee_spouse_max_age')]),
          num(r[c('insurer_guardrails', 'policy_max_age_e')]),
          num(r[c('insurer_guardrails', 'policy_max_age_esc')]),
          num(r[c('insurer_guardrails', 'policy_max_age_escp')]),
          text(r[c('insurer_guardrails', 'family_conditions')]),
          text(r[c('insurer_guardrails', 'maternity_condition')]),
          text(r[c('insurer_guardrails', 'room_rent_options')]),
          text(r[c('insurer_guardrails', 'maternity_limits')]),
          num(r[c('insurer_guardrails', 'commission_pct')]),
          num(r[c('insurer_guardrails', 'xp_share_pct')]),
          num(r[c('insurer_guardrails', 'max_commission_pct')]),
        ]),
        sheets.insurer_guardrails!,
      );

      // --- sku_pricing -------------------------------------------------------
      await upsert(
        client,
        'sku_pricing',
        [
          'insurer_sku_id',
          'sku_name',
          'insurer',
          'insurer_code',
          'plan',
          'family_definition',
          'sum_insured',
          'maternity_option',
          'room_rent_option',
          'parental_copay_option',
          'maternity_code',
          'room_rent_code',
          'parental_copay_code',
          'is_sellable',
          'block_reason_code',
          'block_reason',
          'loading_method',
          'base_rate',
          'maternity_factor',
          'room_rent_factor',
          'copay_factor',
          'per_life_rate',
          'commission_pct',
          'xp_share_pct',
          'max_commission_pct',
        ],
        ['insurer_sku_id'],
        sheets.sku_pricing!.map((r) => [
          text(r[c('sku_pricing', 'insurer_sku_id')]),
          text(r[c('sku_pricing', 'sku_name')]),
          text(r[c('sku_pricing', 'insurer')]),
          text(r[c('sku_pricing', 'insurer_code')]),
          text(r[c('sku_pricing', 'plan')]),
          text(r[c('sku_pricing', 'family_definition')]),
          num(r[c('sku_pricing', 'sum_insured')]),
          text(r[c('sku_pricing', 'maternity_option')]),
          text(r[c('sku_pricing', 'room_rent_option')]),
          text(r[c('sku_pricing', 'parental_copay_option')]),
          text(r[c('sku_pricing', 'maternity_code')]),
          text(r[c('sku_pricing', 'room_rent_code')]),
          text(r[c('sku_pricing', 'parental_copay_code')]),
          bool(r[c('sku_pricing', 'is_sellable')]),
          text(r[c('sku_pricing', 'block_reason_code')]),
          text(r[c('sku_pricing', 'block_reason')]),
          text(r[c('sku_pricing', 'loading_method')]),
          num(r[c('sku_pricing', 'base_rate')]),
          num(r[c('sku_pricing', 'maternity_factor')]),
          num(r[c('sku_pricing', 'room_rent_factor')]),
          num(r[c('sku_pricing', 'copay_factor')]),
          num(r[c('sku_pricing', 'per_life_rate')]),
          num(r[c('sku_pricing', 'commission_pct')]),
          num(r[c('sku_pricing', 'xp_share_pct')]),
          num(r[c('sku_pricing', 'max_commission_pct')]),
        ]),
        sheets.sku_pricing!,
      );

      // --- sku_coverage: wide sheet unpivoted to (sku, benefit_key, value) ---
      const skuIdKey = column(coverage, 'insurer_sku_id');
      const coverageRows: unknown[][] = [];
      for (const row of coverage) {
        const skuId = text(row[skuIdKey]);
        benefitColumns.forEach((key, index) => {
          coverageRows.push([skuId, benefitColumnNames[index], text(row[key])]);
        });
      }
      await upsert(
        client,
        'sku_coverage',
        ['insurer_sku_id', 'benefit_key', 'value'],
        ['insurer_sku_id', 'benefit_key'],
        coverageRows,
      );

      // --- insurer_family_guardrails -----------------------------------------
      await upsert(
        client,
        'insurer_family_guardrails',
        [
          'insurer',
          'family_definition',
          'is_offered',
          'not_offered_reason',
          'conditions',
          'premium_floor',
          'sum_insured_available',
          'policy_max_age',
          'sellable_sku_count',
        ],
        ['insurer', 'family_definition'],
        sheets.insurer_family_guardrails!.map((r) => [
          text(r[c('insurer_family_guardrails', 'insurer')]),
          text(r[c('insurer_family_guardrails', 'family_definition')]),
          bool(r[c('insurer_family_guardrails', 'is_offered')]),
          text(r[c('insurer_family_guardrails', 'not_offered_reason')]),
          text(r[c('insurer_family_guardrails', 'conditions')]),
          text(r[c('insurer_family_guardrails', 'premium_floor')]),
          text(r[c('insurer_family_guardrails', 'sum_insured_available')]),
          text(r[c('insurer_family_guardrails', 'policy_max_age')]),
          num(r[c('insurer_family_guardrails', 'sellable_sku_count')]),
        ]),
        sheets.insurer_family_guardrails!,
      );

      // --- insurer_member_age_windows ----------------------------------------
      await upsert(
        client,
        'insurer_member_age_windows',
        ['insurer', 'member_type', 'min_age', 'max_age', 'is_rateable'],
        ['insurer', 'member_type'],
        sheets.insurer_member_age_windows!.map((r) => [
          text(r[c('insurer_member_age_windows', 'insurer')]),
          text(r[c('insurer_member_age_windows', 'member_type')]),
          num(r[c('insurer_member_age_windows', 'min_age')]),
          num(r[c('insurer_member_age_windows', 'max_age')]),
          bool(r[c('insurer_member_age_windows', 'is_rateable')]),
        ]),
        sheets.insurer_member_age_windows!,
      );

      // --- member_data_rules: the §9/§11 validation engine spec ---------------
      await upsert(
        client,
        'member_data_rules',
        ['rule_id', 'stage', 'rule_name', 'logic', 'applies_to', 'severity', 'action'],
        ['rule_id'],
        sheets.member_data_rules!.map((r) => [
          text(r[c('member_data_rules', 'rule_id')]),
          text(r[c('member_data_rules', 'stage')]),
          text(r[c('member_data_rules', 'rule_name')]),
          text(r[c('member_data_rules', 'logic')]),
          text(r[c('member_data_rules', 'applies_to')]),
          text(r[c('member_data_rules', 'severity')]),
          text(r[c('member_data_rules', 'action')]),
        ]),
        sheets.member_data_rules!,
      );

      // --- appetite ----------------------------------------------------------
      await upsert(
        client,
        'appetite_industry',
        ['industry', 'insurer', 'is_acceptable'],
        ['industry', 'insurer'],
        sheets.appetite_industry!.map((r) => [
          text(r[c('appetite_industry', 'industry')]),
          text(r[c('appetite_industry', 'insurer')]),
          bool(r[c('appetite_industry', 'is_acceptable')]),
        ]),
        sheets.appetite_industry!,
      );

      await upsert(
        client,
        'appetite_entity',
        ['entity_type', 'insurer', 'is_acceptable'],
        ['entity_type', 'insurer'],
        sheets.appetite_entity!.map((r) => [
          text(r[c('appetite_entity', 'entity_type')]),
          text(r[c('appetite_entity', 'insurer')]),
          bool(r[c('appetite_entity', 'is_acceptable')]),
        ]),
        sheets.appetite_entity!,
      );

      // --- rates -------------------------------------------------------------
      await upsert(
        client,
        'rate_base',
        ['insurer', 'insurer_code', 'family_definition', 'sum_insured', 'base_rate'],
        ['insurer', 'family_definition', 'sum_insured'],
        sheets.rate_base!.map((r) => [
          text(r[c('rate_base', 'insurer')]),
          text(r[c('rate_base', 'insurer_code')]),
          text(r[c('rate_base', 'family_definition')]),
          num(r[c('rate_base', 'sum_insured')]),
          num(r[c('rate_base', 'base_rate')]),
        ]),
        sheets.rate_base!,
      );

      await upsert(
        client,
        'rate_factors',
        ['insurer', 'insurer_code', 'dimension', 'option', 'factor'],
        ['insurer', 'dimension', 'option'],
        sheets.rate_factors!.map((r) => [
          text(r[c('rate_factors', 'insurer')]),
          text(r[c('rate_factors', 'insurer_code')]),
          text(r[c('rate_factors', 'dimension')]),
          text(r[c('rate_factors', 'option')]),
          num(r[c('rate_factors', 'factor')]),
        ]),
        sheets.rate_factors!,
      );

      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }

    // Post-import verification against the database, not the spreadsheet.
    const counts = await client.query<{ table_name: string; n: string }>(`
      select 'sku_pricing' as table_name, count(*)::text as n from sku_pricing
      union all select 'sku_coverage', count(*)::text from sku_coverage
      union all select 'benefit_catalogue', count(*)::text from benefit_catalogue
      union all select 'insurer_guardrails', count(*)::text from insurer_guardrails
      union all select 'insurer_family_guardrails', count(*)::text from insurer_family_guardrails
      union all select 'insurer_member_age_windows', count(*)::text from insurer_member_age_windows
      union all select 'member_data_rules', count(*)::text from member_data_rules
      union all select 'appetite_industry', count(*)::text from appetite_industry
      union all select 'appetite_entity', count(*)::text from appetite_entity
      union all select 'rate_base', count(*)::text from rate_base
      union all select 'rate_factors', count(*)::text from rate_factors
      union all select 'ref_enums', count(*)::text from ref_enums
      order by 1
    `);

    console.log('\nImported:');
    for (const row of counts.rows) {
      console.log(`  ${row.table_name.padEnd(28)} ${row.n}`);
    }

    const orphans = await client.query<{ n: string }>(`
      select count(*)::text as n
      from sku_pricing p
      where not exists (
        select 1 from sku_coverage c
        where c.insurer_sku_id = p.insurer_sku_id
      )
    `);
    if (orphans.rows[0]?.n !== '0') {
      throw new Error(`${orphans.rows[0]?.n} SKUs have no coverage rows.`);
    }
    console.log('\nEvery SKU has a full coverage row set.');

    // Direction of change per benefit. Keyed to benefit_catalogue, so it has to
    // follow the workbook rather than ship as its own migration.
    await client.query(readFileSync(join(process.cwd(), 'supabase', 'seed', 'benefit_polarity.sql'), 'utf8'));

    const polarity = await client.query<{ classified: string; total: string }>(`
      select
        count(*) filter (where polarity <> 'none')::text as classified,
        count(*)::text as total
      from benefit_polarity
    `);
    console.log(
      `Change direction set for ${polarity.rows[0]?.classified} of ${polarity.rows[0]?.total} benefits.`,
    );
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
