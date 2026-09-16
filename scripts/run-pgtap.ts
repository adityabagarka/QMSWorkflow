/**
 * Runs every supabase/tests/*.sql suite and reports TAP results.
 * Each suite manages its own transaction and rolls back, so the database is
 * left untouched.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from './db';

const TESTS_DIR = join(process.cwd(), 'supabase', 'tests');

async function main() {
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
