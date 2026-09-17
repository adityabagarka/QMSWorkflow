import { Client, type ClientConfig } from 'pg';
import { config } from 'dotenv';

config({ path: '.env.local' });
config({ path: '.env' });

/**
 * Parses a Postgres connection string into discrete fields.
 *
 * We do NOT hand the raw string to `pg` and let it parse. It uses the WHATWG
 * URL parser, which rejects characters that are perfectly legal in a Postgres
 * password and that libpq (psql) accepts happily:
 *
 *   - `#` starts a URL fragment, so the whole string fails as "Invalid URL".
 *     Supabase's generated passwords contain `#` often enough that this is not
 *     an edge case.
 *   - a leading space is worse: it parses "successfully" into nonsense, giving
 *     a confusing authentication failure rather than a parse error.
 *
 * Percent-encoding the password would also work, but it puts the burden on
 * whoever pastes the string into a secret field — and they have no way to know
 * that is required. Parsing tolerantly here is the honest fix.
 *
 * The password is matched greedily up to the LAST `@`, so passwords containing
 * `@` work too.
 */
function parseConnectionString(raw: string): ClientConfig {
  const value = raw.trim();

  if (!value) {
    throw new Error('DATABASE_URL is empty.');
  }

  const match =
    /^(postgres(?:ql)?):\/\/([^:@/]+)(?::(.*))?@([^@/:]+)(?::(\d+))?(?:\/([^?]*))?(?:\?(.*))?$/s.exec(
      value,
    );

  if (!match) {
    throw new Error(
      'DATABASE_URL is not a recognisable Postgres connection string. ' +
        'Expected the form postgresql://user:password@host:port/database — ' +
        'copy the Session pooler string from Supabase (Project Settings -> Database -> ' +
        'Connection string -> Session pooler) and substitute your password.',
    );
  }

  const [, , user, password, host, port, database, query] = match;
  const params = new URLSearchParams(query ?? '');

  return {
    user: decodeURIComponent(user!),
    // Only decode if it round-trips: a password containing a literal `%` that
    // is not part of an escape would otherwise be mangled, or throw.
    password: password === undefined ? undefined : safeDecode(password),
    host: host!,
    port: port ? Number(port) : 5432,
    database: database ? decodeURIComponent(database) : 'postgres',
    ssl: sslConfig(params.get('sslmode'), host!),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Maps libpq's sslmode to node-postgres' ssl option.
 *
 * With no sslmode given, node-postgres has no equivalent of libpq's `prefer`
 * (try TLS, fall back to plaintext), so we choose by host: a local or CI
 * Postgres has no TLS configured and must connect in the clear, while any
 * hosted database is assumed to require it. Supabase's pooler does.
 *
 * The non-local default matches libpq's `require`: encrypted, but without
 * certificate verification — which is what psql negotiated when it connected
 * successfully. §16 wants certificate verification in production: set
 * `?sslmode=verify-full` on the production connection string, with the
 * provider's CA available to Node.
 */
function sslConfig(sslmode: string | null, host: string): ClientConfig['ssl'] {
  switch (sslmode) {
    case 'disable':
      return false;
    case 'verify-ca':
    case 'verify-full':
      return { rejectUnauthorized: true };
    case 'require':
    case 'prefer':
    case 'allow':
      return { rejectUnauthorized: false };
    default:
      return LOCAL_HOSTS.has(host) ? false : { rejectUnauthorized: false };
  }
}

export function databaseConfig(): ClientConfig {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Locally, copy .env.example to .env.local. ' +
        'In GitHub Actions, add it under Settings -> Secrets and variables -> Actions.',
    );
  }
  return parseConnectionString(url);
}

/**
 * A description of the connection safe to print in CI logs: everything except
 * the password, so a misconfigured secret can be diagnosed without leaking it.
 */
export function describeConnection(): string {
  const c = databaseConfig();
  const ssl = c.ssl === false ? 'disabled' : 'enabled';
  return [
    `user=${c.user}`,
    `host=${c.host}`,
    `port=${c.port}`,
    `database=${c.database}`,
    `password=${c.password ? `set (${c.password.length} characters)` : 'MISSING'}`,
    `ssl=${ssl}`,
  ].join('  ');
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(databaseConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
