/**
 * What the policy reader is allowed to hand on.
 *
 * The network call is not tested here — what matters is the layer between what
 * a model says and what the database accepts, because that is where the rules
 * with consequences live. Two of them are worth naming:
 *
 *   - A value with no quote behind it is not a value. The database refuses one
 *     (migration 0032); this makes sure the app never tries.
 *   - "Not stated" survives. It is a finding about the policy, not a gap to be
 *     tidied away, and an insurer will ask about it.
 *
 * Run with `npm run test:extraction`.
 */
import assert from 'node:assert/strict';
import {
  normaliseReported,
  type CatalogueEntry,
  type ReportedTerm,
} from '../../src/lib/extraction/policy';

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

const catalogue: CatalogueEntry[] = [
  { benefit_key: 'room_rent_limit_normal_room', section: 'Limits', benefit_label: 'Room rent' },
  { benefit_key: 'maternity_cover', section: 'Mother & Child', benefit_label: 'Maternity' },
  { benefit_key: 'day_care_procedures', section: 'Expenses', benefit_label: 'Day care' },
];

function term(over: Partial<ReportedTerm>): ReportedTerm {
  return {
    benefit_key: 'room_rent_limit_normal_room',
    status: 'stated',
    value: 'Rs. 5,000 per day',
    evidence: 'Room rent is payable up to Rs. 5,000 per day.',
    page: 12,
    confidence: 0.9,
    ...over,
  };
}

/** The single term a one-term reading produces, or a failure saying so. */
function one(reported: ReportedTerm[]) {
  const [read] = normaliseReported(reported, catalogue);
  assert.ok(read, 'expected exactly one term back');
  return read;
}

console.log('\nwhat survives from a reading');

check('a stated value with its clause comes through whole', () => {
  const read = one([term({})]);
  assert.equal(read.value, 'Rs. 5,000 per day');
  assert.equal(read.evidence, 'Room rent is payable up to Rs. 5,000 per day.');
  assert.equal(read.page, 12);
  assert.equal(read.confidence, 0.9);
});

check('a value with no quote is demoted, not dropped', () => {
  const read = one([term({ evidence: null })]);
  assert.equal(
    read.benefitKey,
    'room_rent_limit_normal_room',
    'the benefit still has to be answered',
  );
  assert.equal(read.value, null, 'an untraceable value is not a value');
  assert.equal(read.evidence, null);
  assert.equal(read.page, null, 'and it carries no page either');
});

check('an empty quote counts as no quote', () => {
  const read = one([term({ evidence: '   ' })]);
  assert.equal(read.value, null);
});

check('not stated stays not stated', () => {
  const read = one([term({ status: 'not_stated', value: null, evidence: null, page: null })]);
  assert.equal(read.value, null);
  assert.equal(read.evidence, null);
});

check('a value that is only whitespace is not a value', () => {
  const read = one([term({ value: '  ' })]);
  assert.equal(read.value, null);
});

console.log('\nwhat the catalogue decides');

check('a benefit outside the catalogue is dropped', () => {
  const read = normaliseReported([term({}), term({ benefit_key: 'invented_benefit' })], catalogue);
  assert.equal(read.length, 1, 'a key with no catalogue row would fail the foreign key');
  assert.equal(read[0]?.benefitKey, 'room_rent_limit_normal_room');
});

check('the first reading of a benefit wins', () => {
  const read = normaliseReported(
    [term({ value: 'Rs. 5,000 per day' }), term({ value: 'Rs. 9,000 per day' })],
    catalogue,
  );
  assert.equal(read.length, 1);
  assert.equal(read[0]?.value, 'Rs. 5,000 per day', 'a second reading is not a correction');
});

check('a benefit the reader never mentioned is simply absent', () => {
  const read = normaliseReported([term({})], catalogue);
  assert.equal(read.length, 1, 'nothing is invented to fill the catalogue out');
});

console.log('\nthe numbers');

check('confidence is clamped into range', () => {
  assert.equal(one([term({ confidence: 1.4 })]).confidence, 1);
  assert.equal(one([term({ confidence: -2 })]).confidence, 0);
});

check('a missing or unusable confidence lands in the middle', () => {
  assert.equal(one([term({ confidence: null })]).confidence, 0.5);
  assert.equal(
    one([term({ confidence: Number.NaN })]).confidence,
    0.5,
    'NaN would otherwise fail the 0-to-1 check constraint',
  );
});

check('page zero is not a page', () => {
  assert.equal(one([term({ page: 0 })]).page, null);
  assert.equal(one([term({ page: 3.7 })]).page, 3, 'pages are whole');
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall policy extraction assertions passed.');
