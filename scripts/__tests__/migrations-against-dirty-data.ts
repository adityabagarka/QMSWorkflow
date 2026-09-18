/**
 * Migrations, run against data that is already wrong.
 *
 * A schema change is tested twice over: against an empty database, which every
 * other check here does, and against one holding the rows people actually
 * created. The second is the one that breaks.
 *
 * It has broken twice. 0027 had to collapse deals whose company names were
 * typed differently; 0028 added a check constraint refusing a GSTIN as a
 * company name and failed the staging deploy outright, because the first real
 * deal created through this app is named 27AABCM1234N1Z5 — a constraint is a
 * statement about every row, present and past, and repairing what is already
 * there is part of adding one.
 *
 * So: build a database at the migration before the one under test, put the bad
 * rows in, apply the rest, and say what should have happened to them.
 *
 * Needs a Postgres it can create databases on, so it runs in CI against the
 * local server and not against Supabase.
 *
 * Run with `npm run test:migrations`.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type ClientConfig } from 'pg';
import { databaseConfig } from '../db';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');
const SCRATCH = 'qms_dirty_data_check';

let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

/**
 * A connection to the scratch database, reusing the parsed config rather than
 * re-deriving it — the tolerant parser in scripts/db.ts exists because a
 * Supabase password can contain characters a URL parser rejects, and rebuilding
 * a URL here by hand would walk straight back into that.
 */
function configFor(database: string): ClientConfig {
  return { ...databaseConfig(), database };
}

/** The one place a URL is still needed: handing it to the migrator as an env var. */
function urlFor(database: string): string {
  const c = databaseConfig();
  const user = encodeURIComponent(String(c.user ?? 'postgres'));
  const password = typeof c.password === 'string' ? `:${encodeURIComponent(c.password)}` : '';
  return `postgresql://${user}${password}@${String(c.host)}:${c.port}/${database}`;
}

async function admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(configFor(String(databaseConfig().database)));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Applies migrations up to and including `upTo`, by moving the rest aside. */
function migrateUpTo(database: string, upTo: string | null) {
  const held = mkdtempSync(join(tmpdir(), 'held-'));
  const all = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const moved: string[] = [];

  if (upTo) {
    for (const file of all) {
      if (file > upTo) {
        renameSync(join(MIGRATIONS, file), join(held, file));
        moved.push(file);
      }
    }
  }

  try {
    execFileSync('npx', ['tsx', 'scripts/migrate.ts'], {
      env: { ...process.env, DATABASE_URL: urlFor(database) },
      stdio: 'pipe',
    });
  } finally {
    for (const file of moved) renameSync(join(held, file), join(MIGRATIONS, file));
  }
}

async function main() {
  console.log('\nmigrations against dirty data');

  await admin(async (c) => {
    await c.query(`drop database if exists ${SCRATCH}`);
    await c.query(`create database ${SCRATCH}`);
  });

  // The state staging was in: everything up to the customers migration.
  migrateUpTo(SCRATCH, '0027_customers_and_cover_start_reason.sql');

  const client = new Client(configFor(SCRATCH));
  await client.connect();

  // Exactly what a person made: a GSTIN pasted where a name belongs. Plus the
  // nastier shape, where a real customer already holds that GSTIN.
  await client.query(`
    insert into customers (legal_name, gstin) values ('Meridian Synthetic Pvt Ltd', '99AABCM1234N1Z5');
    insert into customers (legal_name) values ('99aabcm1234n1Z5');
    insert into customers (legal_name) values ('99AABCN9876P1Z3');
  `);
  await client.end();

  // Everything after it, which is where the constraint lives.
  migrateUpTo(SCRATCH, null);

  const after = new Client(configFor(SCRATCH));
  await after.connect();

  await check('the migrations apply at all against rows that break them', async () => {
    const { rows } = await after.query(
      `select count(*)::int as n from schema_migrations where filename >= '0028'`,
    );
    assert.ok(rows[0].n >= 2, 'the later migrations should have been recorded');
  });

  await check("a GSTIN is no longer anybody's legal name", async () => {
    const { rows } = await after.query(
      `select count(*)::int as n from customers
        where legal_name ~ '^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]{3}$'`,
    );
    assert.equal(rows[0].n, 0);
  });

  await check('a GSTIN nobody else held moved into the column it belongs in', async () => {
    const { rows } = await after.query(
      `select legal_name from customers where gstin = '99AABCN9876P1Z3'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legal_name, 'Name not captured');
  });

  await check('a GSTIN another customer already held is NOT taken from them', async () => {
    const { rows } = await after.query(
      `select legal_name from customers where gstin = '99AABCM1234N1Z5'`,
    );
    assert.equal(rows.length, 1, 'exactly one customer may hold a GSTIN');
    assert.equal(
      rows[0].legal_name,
      'Meridian Synthetic Pvt Ltd',
      'the real customer keeps it; the duplicate is left for a person to merge',
    );
  });

  await after.end();
  await admin(async (c) => {
    await c.query(`drop database if exists ${SCRATCH}`);
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nmigrations survive the data that is already there.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
