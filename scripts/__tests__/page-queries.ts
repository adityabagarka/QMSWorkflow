/**
 * Every column the app asks a table for, checked against the schema.
 *
 * Written after the terms grid rendered with no rows on a real deal. Migration
 * 0039 moved `input_kind` off `benefit_catalogue` into its own table, the page
 * kept selecting it, PostgREST answered with an error, and `data` came back
 * null — so `rows` was empty and the screen said "All 0 confirmed" with an
 * empty table. Nothing failed loudly anywhere.
 *
 * Neither typecheck nor build can catch this: a Supabase select is a string,
 * and the database it names is not present at compile time. So the strings are
 * extracted from the source and every column in them is looked up for real.
 *
 * Run with `npm run test:page-queries`. Needs DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '../db';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

/** Every .ts/.tsx under src, so a new page is covered without being listed. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

type Query = { file: string; table: string; columns: string[] };

/**
 * Finds `.from('table')` followed by `.select('a, b, c')`.
 *
 * Embedded resources — `customers(brand_name, legal_name)` — are PostgREST's
 * join syntax, so the nested names are checked against the nested table rather
 * than the outer one.
 */
function queriesIn(file: string): Query[] {
  const source = readFileSync(file, 'utf8');
  const out: Query[] = [];
  const pattern = /\.from\(\s*'([a-z_]+)'\s*\)\s*\.select\(\s*(['"`])([\s\S]*?)\2/g;

  for (const match of source.matchAll(pattern)) {
    const table = match[1]!;
    const selectText = match[3]!;

    // Count(*) and head selects name no columns.
    if (!selectText.trim() || selectText.includes('*')) continue;

    let depth = 0;
    let current = '';
    let nested: { table: string; columns: string[] } | null = null;
    const columns: string[] = [];

    const push = () => {
      const name = current.trim();
      current = '';
      if (!name) return;
      // `count` inside an embedded resource is an aggregate, not a column.
      if (name === 'count') return;
      if (nested) nested.columns.push(name);
      else columns.push(name);
    };

    for (const ch of selectText) {
      if (ch === '(') {
        depth += 1;
        if (depth === 1) {
          // `app_users!cases_owner_user_id_fkey(...)` names the relationship to
          // follow when a table is reachable by more than one foreign key. The
          // table is the part before the "!".
          nested = { table: current.trim().split('!')[0]!.trim(), columns: [] };
          current = '';
          continue;
        }
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0 && nested) {
          push();
          out.push({ file, table: nested.table, columns: nested.columns });
          nested = null;
          continue;
        }
      }
      if (ch === ',' && depth <= (nested ? 1 : 0)) {
        push();
        continue;
      }
      current += ch;
    }
    push();

    if (columns.length > 0) out.push({ file, table, columns });
  }

  return out;
}

async function main() {
  console.log('\nevery column the app selects');

  const queries = sourceFiles(join(process.cwd(), 'src')).flatMap(queriesIn);
  assert.ok(queries.length > 10, 'the extractor found almost nothing, so it is broken');

  await withClient(async (client) => {
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'`,
    );

    const schema = new Map<string, Set<string>>();
    for (const row of rows) {
      const cols = schema.get(row.table_name) ?? new Set<string>();
      cols.add(row.column_name);
      schema.set(row.table_name, cols);
    }

    const missing: string[] = [];
    const unknownTables: string[] = [];

    for (const query of queries) {
      const cols = schema.get(query.table);
      if (!cols) {
        unknownTables.push(`${query.table} (${query.file.replace(process.cwd() + '/', '')})`);
        continue;
      }
      for (const column of query.columns) {
        if (!cols.has(column)) {
          missing.push(`${query.table}.${column} — ${query.file.replace(process.cwd() + '/', '')}`);
        }
      }
    }

    check(`every selected column exists (${queries.length} selects checked)`, () => {
      assert.deepEqual(
        missing,
        [],
        `these columns are selected but not in the schema:\n       ${missing.join('\n       ')}`,
      );
    });

    check('every table selected from exists', () => {
      assert.deepEqual(
        unknownTables,
        [],
        `unknown tables:\n       ${unknownTables.join('\n       ')}`,
      );
    });
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nall page query assertions passed.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
