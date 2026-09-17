/**
 * Prints the parsed connection details (never the password) and confirms the
 * database answers. Run first in CI so a bad secret fails with something
 * actionable instead of a parser error thrown from deep inside a library.
 */
import { describeConnection, withClient } from './db';

async function main() {
  console.log(`Connection: ${describeConnection()}`);

  await withClient(async (client) => {
    const { rows } = await client.query<{ version: string; db: string; user: string }>(
      'select version() as version, current_database() as db, current_user as user',
    );
    const row = rows[0]!;
    console.log(`Connected as ${row.user} to ${row.db}`);
    console.log(row.version);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
