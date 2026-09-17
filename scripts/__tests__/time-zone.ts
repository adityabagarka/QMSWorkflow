/**
 * The date helpers must answer in India time whatever zone the process runs in.
 *
 * Vercel's functions, the Postgres server and CI all run on UTC, and IST is
 * UTC+5:30 — so between 18:30 and midnight India time the two disagree about
 * what day it is. Every assertion below is run twice, once with TZ=UTC and once
 * with TZ=Asia/Kolkata, and must give the same answer both times. A helper that
 * quietly reads the process clock's zone fails the UTC pass.
 *
 * Run with `npm run test:time`.
 */
import assert from 'node:assert/strict';
import { formatDate, formatDateTime, daysUntil, yearsSince } from '../../src/lib/format';

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

/** Freeze the clock so "today" is a fixed instant, then restore it. */
function at(iso: string, fn: () => void) {
  const RealDate = Date;
  const fixed = new RealDate(iso).getTime();
  // Only the no-argument constructor is frozen; `new Date(value)` must still
  // parse normally, because that is what the helpers do to their inputs.
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
      // @ts-expect-error — spreading a tuple union into super is fine at runtime.
      args.length === 0 ? super(fixed) : super(...args);
    }
    static now() {
      return fixed;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = FrozenDate as unknown as DateConstructor;
  try {
    fn();
  } finally {
    (globalThis as { Date: DateConstructor }).Date = RealDate;
  }
}

function suite() {
  console.log(`\nTZ=${process.env.TZ}`);

  // 22:00 IST on 30 September is 16:30 UTC the same day — both zones agree.
  check('a date renders as itself', () => {
    assert.equal(formatDate('2026-10-01'), '1 Oct 2026');
  });

  // 23:30 IST on 30 September is 18:00 UTC on 30 September; 00:30 IST on
  // 1 October is 19:00 UTC on 30 September — the UTC day is still the 30th.
  check('an evening instant is filed under the India day, not the UTC one', () => {
    assert.equal(formatDate('2026-09-30T19:00:00Z'), '1 Oct 2026');
    assert.equal(formatDateTime('2026-09-30T19:00:00Z'), '1 Oct, 12:30 am');
  });

  check('an instant before 18:30 UTC is the same day in both zones', () => {
    assert.equal(formatDate('2026-09-30T06:00:00Z'), '30 Sept 2026');
  });

  // The countdown is the one a user reads on the summary block. At 11pm on
  // 30 September India time, cover starting 1 October is TOMORROW — one day,
  // not two, which is what a UTC-based subtraction would have said.
  at('2026-09-30T19:00:00Z', () => {
    check('the countdown counts calendar days in India', () => {
      assert.equal(daysUntil('2026-10-01'), 0, 'it is already 1 Oct in India');
      assert.equal(daysUntil('2026-10-02'), 1);
      assert.equal(daysUntil('2026-09-30'), -1, 'yesterday, in India');
    });
  });

  at('2026-09-30T06:00:00Z', () => {
    check('the countdown before the divergence hour', () => {
      assert.equal(daysUntil('2026-10-01'), 1);
      assert.equal(daysUntil('2026-09-30'), 0);
    });
  });

  at('2026-09-30T19:00:00Z', () => {
    check('a null date has no countdown', () => {
      assert.equal(daysUntil(null), null);
      assert.equal(yearsSince(null), null);
    });

    check('company age is whole years', () => {
      assert.equal(yearsSince('2012-06-14'), 14);
      assert.equal(yearsSince('2026-01-01'), 0);
    });
  });

  check('a missing value renders as an em dash, not "Invalid Date"', () => {
    assert.equal(formatDate(null), '—');
    assert.equal(formatDateTime(undefined), '—');
  });
}

suite();

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall time-zone assertions passed.');
