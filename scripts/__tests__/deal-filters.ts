/**
 * What the deal list's filters mean.
 *
 * These values reach a database query built from a URL anybody can type, and
 * the month filter does date arithmetic on a page that runs on India time
 * while CI does not. Both are worth stating without a database.
 *
 * Run with `npm run test:deal-filters`.
 */
import assert from 'node:assert/strict';
import {
  NO_MONTH,
  activeFilterCount,
  monthLabel,
  monthOptions,
  monthRange,
  readDealFilters,
} from '../../src/lib/cases/deal-filters';

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

console.log('\nreading the filters off the URL');

check('every filter is read', () => {
  const filters = readDealFilters({
    stage: '3',
    month: '2027-04',
    insurer: 'ICICI Lombard',
    customer: '0f2d7b1e-1111-4c2a-9f3d-2b6a5c8e1d40',
    type: 'rollover',
    owner: 'mine',
  });

  assert.deepEqual(filters, {
    stage: 3,
    month: '2027-04',
    insurer: 'ICICI Lombard',
    customer: '0f2d7b1e-1111-4c2a-9f3d-2b6a5c8e1d40',
    dealType: 'rollover',
    owner: 'mine',
  });
  assert.equal(activeFilterCount(filters), 6);
});

check('nothing asked for is nothing filtered', () => {
  const filters = readDealFilters({});
  assert.equal(activeFilterCount(filters), 0);
  assert.equal(filters.stage, null);
});

check('an empty parameter is not a filter', () => {
  // A GET form submits every control it holds. The empty ones are dropped on
  // the way out, but a hand-edited URL can still carry them.
  assert.equal(activeFilterCount(readDealFilters({ stage: '', insurer: '   ' })), 0);
});

check('a nonsense value is dropped, not passed to the query', () => {
  assert.equal(readDealFilters({ stage: 'banana' }).stage, null);
  assert.equal(readDealFilters({ stage: '-1' }).stage, null);
  assert.equal(readDealFilters({ stage: '99' }).stage, null, 'there is no stage 99');
  assert.equal(readDealFilters({ month: '2027-13' }).month, null);
  assert.equal(readDealFilters({ month: 'April' }).month, null);
  assert.equal(readDealFilters({ owner: 'everyone' }).owner, null);
});

check('stage zero is a filter, not an absence', () => {
  const filters = readDealFilters({ stage: '0' });
  assert.equal(filters.stage, 0, 'Deal is the first step, and 0 is falsy');
  assert.equal(activeFilterCount(filters), 1);
});

check('a repeated parameter takes the first', () => {
  assert.equal(readDealFilters({ stage: ['2', '4'] }).stage, 2);
});

console.log('\nthe month a deal starts in');

check('a month is a half-open range, not a pair of ends', () => {
  // `lt` the first of the next month rather than `lte` the 30th: no month has
  // to be remembered, and a cover start on the last day is still inside it.
  assert.deepEqual(monthRange('2027-04'), { from: '2027-04-01', to: '2027-05-01' });
});

check('December rolls into the next year', () => {
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
});

check('February is not special, because nothing counts days', () => {
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-03-01' });
});

check('a month is labelled without ever becoming a Date', () => {
  // Built through `new Date('2027-04-01')` this reads as March in any timezone
  // behind UTC, which is every deal we write.
  assert.equal(monthLabel('2027-04'), 'April 2027');
  assert.equal(monthLabel('2027-01'), 'January 2027');
  assert.equal(monthLabel('2027-12'), 'December 2027');
  assert.equal(monthLabel(NO_MONTH), 'No date set');
});

check('the months offered are the months that have deals', () => {
  assert.deepEqual(monthOptions(['2027-04-01', '2027-04-30', '2026-12-15', null, '2027-01-02']), [
    '2026-12',
    '2027-01',
    '2027-04',
    NO_MONTH,
  ]);
});

check('"no date set" is offered only when some deal has none', () => {
  assert.deepEqual(monthOptions(['2027-04-01']), ['2027-04']);
  assert.deepEqual(monthOptions([]), []);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall deal filter assertions passed.');
