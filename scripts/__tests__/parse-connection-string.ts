/**
 * Connection-string parsing cases, including the one that broke the first
 * staging deploy: a `#` in the password. Run with `npm run test:parse`.
 */
import assert from 'node:assert/strict';
import { databaseConfig, describeConnection } from '../db';

const cases: { name: string; url: string; expect: Record<string, unknown> }[] = [
  {
    name: 'plain password',
    url: 'postgresql://postgres.abc:simple@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
    expect: {
      user: 'postgres.abc',
      password: 'simple',
      host: 'aws-0-ap-south-1.pooler.supabase.com',
      port: 5432,
      database: 'postgres',
    },
  },
  {
    name: 'hash in password (broke deploy #1)',
    url: 'postgresql://postgres.abc:Pa#ss#word@db.example.com:5432/postgres',
    expect: { password: 'Pa#ss#word', host: 'db.example.com' },
  },
  {
    name: 'at sign in password',
    url: 'postgresql://postgres.abc:pa@ss@db.example.com:5432/postgres',
    expect: { password: 'pa@ss', host: 'db.example.com' },
  },
  {
    name: 'question mark in password',
    url: 'postgresql://postgres.abc:pa?ss@db.example.com:5432/postgres',
    expect: { password: 'pa?ss', host: 'db.example.com' },
  },
  {
    name: 'leading and trailing whitespace (silently corrupted before)',
    url: '  postgresql://postgres.abc:simple@db.example.com:5432/postgres\n',
    expect: { host: 'db.example.com', password: 'simple' },
  },
  {
    name: 'postgres:// scheme',
    url: 'postgres://postgres.abc:simple@db.example.com:5432/postgres',
    expect: { host: 'db.example.com' },
  },
  {
    name: 'sslmode=verify-full turns on certificate verification',
    url: 'postgresql://postgres.abc:simple@db.example.com:5432/postgres?sslmode=verify-full',
    expect: { ssl: { rejectUnauthorized: true } },
  },
  {
    name: 'local host defaults to no TLS (local and CI Postgres have none)',
    url: 'postgresql://postgres@localhost:5433/postgres',
    expect: { ssl: false, host: 'localhost', port: 5433, password: undefined },
  },
  {
    name: 'hosted host defaults to TLS on',
    url: 'postgresql://postgres.abc:simple@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
    expect: { ssl: { rejectUnauthorized: false } },
  },
  {
    name: 'sslmode=disable is honoured even on a hosted host',
    url: 'postgresql://postgres.abc:simple@db.example.com:5432/postgres?sslmode=disable',
    expect: { ssl: false },
  },
  {
    name: 'percent-encoded password still decodes',
    url: 'postgresql://postgres.abc:pa%23ss@db.example.com:5432/postgres',
    expect: { password: 'pa#ss' },
  },
];

let failures = 0;

for (const testCase of cases) {
  process.env.DATABASE_URL = testCase.url;
  try {
    const config = databaseConfig() as Record<string, unknown>;
    for (const [key, value] of Object.entries(testCase.expect)) {
      assert.deepEqual(config[key], value, `${testCase.name}: ${key}`);
    }
    console.log(`ok   ${testCase.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${testCase.name}: ${error instanceof Error ? error.message : error}`);
  }
}

// A malformed string must fail loudly, with advice rather than "Invalid URL".
process.env.DATABASE_URL = 'not-a-connection-string';
try {
  databaseConfig();
  failures += 1;
  console.error('FAIL malformed string should throw');
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  assert.ok(message.includes('Session pooler'), 'error should point at the right Supabase field');
  console.log('ok   malformed string fails with actionable advice');
}

// The diagnostic must never print the password itself.
process.env.DATABASE_URL = 'postgresql://postgres.abc:SuperSecret#1@db.example.com:5432/postgres';
const described = describeConnection();
assert.ok(!described.includes('SuperSecret'), 'describeConnection must not leak the password');
assert.ok(described.includes('13 characters'), 'describeConnection should report the length');
console.log('ok   describeConnection hides the password but reports its length');

if (failures > 0) {
  console.error(`\n${failures} failing case(s)`);
  process.exit(1);
}
console.log('\nAll connection-string cases passed.');
