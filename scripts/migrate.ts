/**
 * Applies supabase/migrations/*.sql in filename order, exactly once each.
 *
 * Deliberately plain SQL rather than an ORM migration tool: M0 is mostly RLS
 * policies, grants and triggers, which ORMs model poorly, and §3.1 requires
 * the schema to pg_dump/pg_restore cleanly into RDS or Cloud SQL later.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { withClient } from './db';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const reset = process.argv.includes('--reset');

async function main() {
  await withClient(async (client) => {
    if (reset) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Refusing to --reset with NODE_ENV=production.');
      }
      console.warn('! Dropping and recreating schemas public and app');
      await client.query('drop schema if exists public cascade');
      await client.query('drop schema if exists app cascade');
      await client.query('create schema public');
    }

    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Map<string, string>(
      (await client.query('select filename, checksum from schema_migrations')).rows.map(
        (r: { filename: string; checksum: string }) => [r.filename, r.checksum],
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = applied.get(filename);

      if (previous === checksum) {
        continue;
      }
      if (previous && previous !== checksum) {
        // An applied migration that has since been edited means the database
        // and the repository disagree about history. Fix it forward with a new
        // migration rather than letting this run silently.
        throw new Error(
          `${filename} has changed since it was applied. Add a new migration instead of editing an applied one.`,
        );
      }

      process.stdout.write(`→ ${filename} ... `);
      // Each migration is its own transaction: a failure leaves the database
      // on the last good migration rather than half-applied.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (filename, checksum) values ($1, $2)', [
          filename,
          checksum,
        ]);
        await client.query('commit');
        console.log('ok');
      } catch (error) {
        await client.query('rollback');
        console.log('failed');
        throw error;
      }
    }

    console.log('Migrations up to date.');
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
