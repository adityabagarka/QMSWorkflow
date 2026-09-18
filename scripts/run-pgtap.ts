/**
 * Runs every supabase/tests/*.sql suite and reports TAP results.
 * Each suite manages its own transaction and rolls back, so the database is
 * left untouched.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from './db';

const TESTS_DIR = join(process.cwd(), 'supabase', 'tests');

/**
 * The suites create rows — a company, a user, a case — and roll them back. On a
 * disposable database that is harmless. On a real one it is not: five deploys
 * in a row failed because a fixture's email or GSTIN collided with a row that
 * already existed there, and a rolled-back transaction does not undo a unique
 * index it had to wait on. So this refuses to run anywhere but a local,
 * throwaway Postgres unless it is told, in as many words, that the target is
 * disposable.
 *
 * What the deployed database should be checked for instead is in
 * `scripts/smoke-staging.ts`: catalogue reads only, nothing written.
 */
function refuseARealDatabase() {
  if (process.env.PGTAP_TARGET_IS_DISPOSABLE === 'yes') return;

  const url = process.env.DATABASE_URL ?? '';
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }

  const local = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'];
  if (local.includes(host)) return;

  console.error(
    `Refusing to run the fixture suites against ${host || 'this database'}.\n` +
      'These tests write rows. Point DATABASE_URL at a scratch Postgres, or set\n' +
      'PGTAP_TARGET_IS_DISPOSABLE=yes if the target really is throwaway.\n' +
      'To check a deployed database, run `npm run db:smoke` instead.',
  );
  process.exit(1);
}

async function main() {
  refuseARealDatabase();

  const failures: string[] = [];

  await withClient(async (client) => {
    await client.query('create extension if not exists pgtap');

    for (const filename of readdirSync(TESTS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      console.log(`\n# ${filename}`);
      const sql = readFileSync(join(TESTS_DIR, filename), 'utf8');
      const results = await client.query(sql);

      // pgTAP emits one TAP line per row; the suite's own BEGIN/ROLLBACK means
      // the driver hands back an array of results, one per statement.
      const lines = (Array.isArray(results) ? results : [results])
        .flatMap((r) => (r?.rows ?? []) as Record<string, unknown>[])
        .map((row) => String(Object.values(row)[0] ?? ''))
        .filter((line) => /^(ok|not ok|# )/.test(line));

      for (const line of lines) {
        console.log(line);
        if (line.startsWith('not ok')) {
          failures.push(`${filename}: ${line}`);
        }
      }
    }
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} failing assertion(s):`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('\nAll database assertions passed.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
