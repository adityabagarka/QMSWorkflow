/**
 * Is the deployed database sound?
 *
 * A different question from "does the schema behave correctly", and the
 * confusion between the two has now failed five staging deploys.
 *
 * The pgTAP suite answers the behaviour question. It does so by CREATING ROWS —
 * users, customers, cases — and a database with real data in it is the one
 * place those fixtures can collide with something. They have, five times: a
 * real email address, a real case count, a real GSTIN. Every fix was correct
 * and the next one arrived anyway, because the arrangement was wrong: fixtures
 * and production data should never be in the same database.
 *
 * So the suite runs against a scratch Postgres in CI, where the fixtures are
 * the only data there is, and this runs against staging instead. It reads the
 * catalogue and counts reference rows. It writes nothing, so there is nothing
 * to collide with — and it checks things the fixture suite cannot, because they
 * are properties of the deployed database rather than of the schema:
 *
 *   - every migration in the repository is recorded as applied
 *   - every table holding case data has row-level security ON
 *   - every app-schema function the app calls has its public wrapper
 *   - the audit log is still append-only
 *   - the guardrails reference data is actually loaded
 *
 * The RLS check is the valuable one. A new case-scoped table shipped without a
 * policy is a hole in §15 that no fixture test would notice, because a test
 * only covers the tables somebody remembered to write a test for.
 *
 * Run with `npm run db:smoke`.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from './db';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/**
 * Tables that hold no case data and are readable by any signed-in user:
 * guardrails reference data, the benefit catalogue, the enum lookups. RLS is
 * still enabled on them, but the check below cares about the ones carrying a
 * case_id — these are listed so the report says why they are exempt from the
 * case-scoping rule rather than silently passing.
 */
let failures = 0;
let checks = 0;

function report(ok: boolean, name: string, detail = '') {
  checks += 1;
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\nstaging smoke checks');

  await withClient(async (client) => {
    // ── Every migration applied ──────────────────────────────────────────
    const onDisk = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const { rows: applied } = await client.query<{ filename: string }>(
      'select filename from schema_migrations',
    );
    const appliedSet = new Set(applied.map((r) => r.filename));
    const missing = onDisk.filter((f) => !appliedSet.has(f));

    report(
      missing.length === 0,
      `every migration is applied (${onDisk.length} on disk)`,
      missing.length > 0 ? `not applied: ${missing.join(', ')}` : '',
    );

    // ── RLS on everything holding case data ──────────────────────────────
    const { rows: unprotected } = await client.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not c.relrowsecurity
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public'
            and col.table_name = c.relname
            and col.column_name in ('case_id', 'owner_user_id')
        )
      order by 1
    `);

    report(
      unprotected.length === 0,
      'row-level security is on for every table holding case data',
      unprotected.length > 0
        ? `NO RLS: ${unprotected.map((r) => r.table_name).join(', ')} — this is a hole in §15`
        : '',
    );

    // A table with RLS on and no policies is unreadable rather than open, so
    // this is a correctness check rather than a security one — but a table
    // nobody can read is a bug that presents as an empty screen.
    const { rows: policyless } = await client.query<{ table_name: string }>(`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
      order by 1
    `);

    report(
      policyless.length === 0,
      'every protected table has at least one policy',
      policyless.length > 0 ? `no policies: ${policyless.map((r) => r.table_name).join(', ')}` : '',
    );

    // ── The RPC surface PostgREST can actually see ───────────────────────
    //
    // `app` is not exposed over HTTP, so anything the application calls through
    // supabase.rpc() needs a public wrapper. Missing one presents as a baffling
    // permission error at runtime, which is how an afternoon went once.
    const WRAPPED = [
      'provision_signed_in_user',
      'decide_access_request',
      'decide_user_access',
      'classify_term_change',
      'rfq_blockers',
    ];

    const { rows: publicFns } = await client.query<{ routine_name: string }>(
      `select routine_name from information_schema.routines where routine_schema = 'public'`,
    );
    const exposed = new Set(publicFns.map((r) => r.routine_name));
    const unwrapped = WRAPPED.filter((f) => !exposed.has(f));

    report(
      unwrapped.length === 0,
      'every function the app calls over HTTP has a public wrapper',
      unwrapped.length > 0 ? `not exposed: ${unwrapped.join(', ')}` : '',
    );

    // ── The audit log is still append-only (§16) ─────────────────────────
    const { rows: auditGrants } = await client.query<{ privilege_type: string; grantee: string }>(`
      select privilege_type, grantee
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'audit_log'
        and privilege_type in ('UPDATE', 'DELETE')
        and grantee in ('authenticated', 'anon', 'service_role')
    `);

    report(
      auditGrants.length === 0,
      'the audit log grants no UPDATE or DELETE to any application role',
      auditGrants.length > 0
        ? auditGrants.map((g) => `${g.grantee} has ${g.privilege_type}`).join('; ')
        : '',
    );

    // ── Reference data is loaded ─────────────────────────────────────────
    const EXPECTED: [string, number][] = [
      ['benefit_catalogue', 1],
      ['sku_pricing', 1],
      ['sku_coverage', 1],
      ['ref_enums', 1],
      ['allowed_email_domains', 1],
    ];

    for (const [table, atLeast] of EXPECTED) {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from ${table}`,
      );
      const n = Number(rows[0]?.n ?? 0);
      report(n >= atLeast, `${table} has data (${n} rows)`);
    }

    // ── India time, as migration 0025 set it ─────────────────────────────
    /*
     * Migration 0025 sets India time on the roles the app connects as. Read it
     * back off the roles rather than off this session: the smoke check may well
     * connect as a pooler user that is not one of them, and a UTC session here
     * would say nothing about what the app sees.
     */
    const { rows: tzRoles } = await client.query<{ rolname: string; tz: string | null }>(`
      select r.rolname,
             (select split_part(c, '=', 2)
                from unnest(coalesce(r.rolconfig, '{}')) as c
               where c like 'TimeZone=%') as tz
        from pg_roles r
       where r.rolname in ('authenticated', 'anon', 'service_role', 'postgres')
    `);
    const wrongTz = tzRoles.filter((r) => r.tz !== 'Asia/Kolkata');
    report(
      tzRoles.length > 0 && wrongTz.length === 0,
      wrongTz.length === 0
        ? `every application role runs on India time (${tzRoles.length} roles)`
        : `every application role runs on India time — ${wrongTz
            .map((r) => `${r.rolname}=${r.tz ?? 'unset'}`)
            .join(', ')}`,
    );
  });

  console.log(`\n${checks - failures} of ${checks} checks passed.`);

  if (failures > 0) {
    console.error('\nThe deployed database is not in the state it should be.');
    process.exit(1);
  }
  console.log('The deployed database is sound.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
