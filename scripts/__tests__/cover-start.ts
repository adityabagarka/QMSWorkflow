/**
 * Cover-start derivation and the rules around shifting it.
 *
 * The derivation crosses month and year boundaries and a leap day, because
 * "add one day" is where off-by-one bugs live, and an inception date that is a
 * day out is a day of uninsured lives.
 *
 * Run with `npm run test:cover-start`.
 */
import assert from 'node:assert/strict';
import { deriveCoverStart, resolveCoverStart } from '../../src/lib/cases/cover-start';

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

check('the day after expiry, mid-month', () => {
  assert.equal(deriveCoverStart('2026-06-14'), '2026-06-15');
});

check('across a month boundary', () => {
  assert.equal(deriveCoverStart('2026-06-30'), '2026-07-01');
});

check('across a year boundary', () => {
  assert.equal(deriveCoverStart('2026-12-31'), '2027-01-01');
});

check('across a leap day', () => {
  assert.equal(deriveCoverStart('2028-02-28'), '2028-02-29');
  assert.equal(deriveCoverStart('2028-02-29'), '2028-03-01');
});

check('a non-leap February ends on the 28th', () => {
  assert.equal(deriveCoverStart('2027-02-28'), '2027-03-01');
});

check('no expiry date means nothing to derive from', () => {
  assert.equal(deriveCoverStart(null), null);
  assert.equal(deriveCoverStart(''), null);
  assert.equal(deriveCoverStart('not a date'), null);
});

check('start equal to the derived date needs no reason', () => {
  const r = resolveCoverStart({
    coverStart: '2026-11-01',
    derived: '2026-11-01',
    reason: null,
    note: null,
  });
  assert.equal(r.ok, true);
});

check('a shift with no reason is refused', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: '2026-11-01',
    reason: null,
    note: null,
  });
  assert.equal(r.ok, false);
});

check('a shift with a known reason is accepted', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: '2026-11-01',
    reason: 'gap_accepted',
    note: null,
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.cover_start_change_reason, 'gap_accepted');
});

check('a reason outside the vocabulary is refused', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: '2026-11-01',
    reason: 'client_was_busy',
    note: null,
  });
  assert.equal(r.ok, false);
});

check('"other" with no note is refused — it looks answered and says nothing', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: '2026-11-01',
    reason: 'other',
    note: null,
  });
  assert.equal(r.ok, false);
});

check('"other" with a note is accepted', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: '2026-11-01',
    reason: 'other',
    note: 'Insurer could not issue in time',
  });
  assert.equal(r.ok, true);
});

check('a reason left from an earlier edit is cleared once the shift is undone', () => {
  const r = resolveCoverStart({
    coverStart: '2026-11-01',
    derived: '2026-11-01',
    reason: 'gap_accepted',
    note: 'stale',
  });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.cover_start_change_reason, null);
  assert.equal(r.ok && r.value.cover_start_change_note, null);
});

check('no derivation yet means no reason is demanded', () => {
  const r = resolveCoverStart({
    coverStart: '2026-12-01',
    derived: null,
    reason: null,
    note: null,
  });
  assert.equal(r.ok, true);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall cover-start assertions passed.');
