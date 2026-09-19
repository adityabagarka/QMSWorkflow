/**
 * The terms grid's write path, against a real database.
 *
 * Written after manual entry silently lost data on a real deal. The pgTAP
 * suites passed throughout and told us nothing, because the schema was never
 * the problem: it accepts these rows happily. What failed was the sequence the
 * app performs — find or create the policy, then upsert the term — under the
 * one condition that holds on every new deal, which is that the policy row does
 * not exist yet and several cells are saving at once.
 *
 * So this exercises the sequence rather than the constraints, and it runs the
 * saves concurrently on purpose.
 *
 * Run with `npm run test:term-writes`. Needs DATABASE_URL.
 */
import assert from 'node:assert/strict';
import { withClient } from '../db';

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

/** The same find-or-create the action performs, in SQL. */
const UPSERT_POLICY = `
  insert into policies (case_id) values ($1)
  on conflict (case_id) do update set case_id = excluded.case_id
  returning id
`;

const UPSERT_TERM = `
  insert into policy_terms
    (case_id, policy_id, benefit_key, value, source, review_status, reviewed_by, reviewed_at, updated_at)
  values ($1, $2, $3, $4, 'manual', 'confirmed', $5, now(), now())
  on conflict (policy_id, benefit_key) do update
    set value = excluded.value,
        source = excluded.source,
        review_status = excluded.review_status,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at
  returning id
`;

async function main() {
  console.log('\nthe terms grid write path');

  await withClient(async (client) => {
    await client.query('begin');

    const rm = '00000000-dead-4000-8000-000000000001';
    const cust = '00000000-dead-4000-8000-000000000002';
    const deal = '00000000-dead-4000-8000-000000000003';

    await client.query(
      `insert into app_users (id, email, name, role, status)
       values ($1, 'termwrites@example.test', 'RM', 'consultant', 'active')`,
      [rm],
    );
    await client.query(
      `insert into customers (id, legal_name, gstin) values ($1, 'Term Writes Synthetic Pvt Ltd', '99AAECW1234N1Z5')`,
      [cust],
    );
    await client.query(`insert into cases (id, customer_id, owner_user_id) values ($1, $2, $3)`, [
      deal,
      cust,
      rm,
    ]);

    /*
     * Its own benefits, not the catalogue's. The suites run against a freshly
     * reset database where the guardrails workbook has not been imported yet,
     * and a test that reads whatever the catalogue happens to hold is a
     * measurement of the database rather than of these fixtures
     * (supabase/tests/README.md).
     */
    const benefits = [
      { benefit_key: 'write_test_one' },
      { benefit_key: 'write_test_two' },
      { benefit_key: 'write_test_three' },
      { benefit_key: 'write_test_four' },
    ];

    for (const [i, b] of benefits.entries()) {
      await client.query(
        `insert into benefit_catalogue (benefit_key, display_order, section, benefit_label)
         values ($1, $2, 'Write test', $3)
         on conflict (benefit_key) do nothing`,
        [b.benefit_key, 9500 + i, `Write Test ${i + 1}`],
      );
    }

    await check('a case starts with no expiring-policy row', async () => {
      const { rows } = await client.query(`select id from policies where case_id = $1`, [deal]);
      assert.equal(rows.length, 0);
    });

    // The bug: several cells saving at once on a case with no policy row. Each
    // save finds nothing and inserts, and case_id is unique.
    await check('four terms typed at once all survive', async () => {
      await Promise.all(
        benefits.map(async (b, i) => {
          const { rows } = await client.query<{ id: string }>(UPSERT_POLICY, [deal]);
          const policyId = rows[0]?.id;
          assert.ok(policyId, `no policy id for ${b.benefit_key}`);
          await client.query(UPSERT_TERM, [deal, policyId, b.benefit_key, `Value ${i}`, rm]);
        }),
      );

      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from policy_terms where case_id = $1`,
        [deal],
      );
      assert.equal(Number(rows[0]?.n), benefits.length, 'every typed term was written');
    });

    await check('exactly one policy row exists for the case', async () => {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from policies where case_id = $1`,
        [deal],
      );
      assert.equal(Number(rows[0]?.n), 1);
    });

    await check('typing a value counts as confirming it', async () => {
      const { rows } = await client.query<{ review_status: string; source: string }>(
        `select review_status, source from policy_terms where case_id = $1 limit 1`,
        [deal],
      );
      assert.equal(rows[0]?.source, 'manual');
      assert.equal(rows[0]?.review_status, 'confirmed', 'so it stops counting as outstanding');
    });

    await check('re-typing a term replaces it rather than adding a second', async () => {
      const key = benefits[0]!.benefit_key;
      const { rows: p } = await client.query<{ id: string }>(UPSERT_POLICY, [deal]);
      await client.query(UPSERT_TERM, [deal, p[0]!.id, key, 'Corrected value', rm]);

      const { rows } = await client.query<{ value: string; n: string }>(
        `select value, count(*) over ()::text as n from policy_terms
          where case_id = $1 and benefit_key = $2`,
        [deal, key],
      );
      assert.equal(rows.length, 1, 'one row per benefit');
      assert.equal(rows[0]?.value, 'Corrected value');
    });

    await check('what was written is what reads back', async () => {
      const { rows } = await client.query<{ benefit_key: string; value: string }>(
        `select t.benefit_key, t.value
           from policy_terms t
           join policies p on p.id = t.policy_id
          where p.case_id = $1
          order by t.benefit_key`,
        [deal],
      );
      assert.equal(rows.length, benefits.length, 'the step reloads everything it saved');
      for (const row of rows) assert.ok(row.value, `${row.benefit_key} came back empty`);
    });

    await client.query('rollback');
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nall term write assertions passed.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
