/**
 * The deviation engine and the burn calculation.
 *
 * Two rules here are load-bearing and both are easy to "helpfully" break later,
 * so each has an assertion that says so by name:
 *
 *   - Nobody is dropped. A life outside the terms is flagged, never filtered.
 *   - Loadings come out of the premium, not onto the claims.
 *
 * Run with `npm run test:members`.
 */
import assert from 'node:assert/strict';
import {
  findDeviations,
  parseAgeCeiling,
  parseCoveredRelationships,
  summariseDeviations,
  type MemberForCheck,
} from '../../src/lib/members/deviations';
import { computeBurn, comparedWithExpiring, BURN_DEFAULTS } from '../../src/lib/members/burn';

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

// ── reading terms ─────────────────────────────────────────────────────────
console.log('\nreading the governing terms');

check('an age ceiling out of the ways it is written', () => {
  assert.equal(parseAgeCeiling('80 years'), 80);
  assert.equal(parseAgeCeiling('Upto 80 yrs'), 80);
  assert.equal(parseAgeCeiling('91 days - 80 years'), 80, 'a band ends at its ceiling');
  assert.equal(parseAgeCeiling('25 years'), 25);
});

check('a term claiming no limit yields no ceiling', () => {
  assert.equal(parseAgeCeiling('No age limit'), null);
  assert.equal(parseAgeCeiling('Lifelong renewability'), null);
});

check('a term this cannot read raises nothing rather than guessing', () => {
  assert.equal(parseAgeCeiling('As per policy schedule'), null);
  assert.equal(parseAgeCeiling(null), null);
});

check('which relationships a members-covered term admits', () => {
  const covered = parseCoveredRelationships('Employee, Spouse, Children, Parents');
  assert.ok(covered);
  assert.ok(covered!.has('spouse') && covered!.has('child') && covered!.has('parent'));
  assert.ok(!covered!.has('sibling'));
});

check('parents-in-law are not parents', () => {
  const covered = parseCoveredRelationships('Employee, Spouse, Children, Parents-in-law');
  assert.ok(covered!.has('parent_in_law'));
});

check('an unreadable members term claims nothing', () => {
  assert.equal(parseCoveredRelationships('As defined in the schedule'), null);
});

// ── deviations ────────────────────────────────────────────────────────────
console.log('\ndeviations');

const TERMS = {
  members_covered: 'Employee, Spouse, Children, Parents',
  siblings: 'Not covered',
  max_age_parents: '80 years',
  max_age_children: '25 years',
  max_age_employee_spouse: '70 years',
  age_band: '91 days - 80 years',
};

const ROSTER: MemberForCheck[] = [
  { id: 'm1', relationship: 'self', age: 41, name: 'Asha', employeeId: 'E001' },
  { id: 'm2', relationship: 'spouse', age: 39, name: 'Ravi', employeeId: 'E001' },
  { id: 'm3', relationship: 'parent', age: 82, name: 'Leela', employeeId: 'E002' },
  { id: 'm4', relationship: 'child', age: 27, name: 'Nikhil', employeeId: 'E003' },
  { id: 'm5', relationship: 'sibling', age: 33, name: 'Priya', employeeId: 'E004' },
  { id: 'm6', relationship: 'parent', age: 74, name: 'Mohan', employeeId: 'E005' },
];

const found = findDeviations(ROSTER, TERMS, 'expiring_policy');

check('NOBODY IS DROPPED — the roster is not filtered by this', () => {
  // The engine returns deviations, never a shortened roster. If this ever
  // returns members, something has started deciding eligibility.
  assert.ok(Array.isArray(found));
  assert.ok(found.every((d) => 'memberId' in d && 'detail' in d));
});

check('a parent above the ceiling is flagged as a continuation', () => {
  const leela = found.find((d) => d.memberId === 'm3');
  assert.ok(leela, 'the 82-year-old parent must be flagged');
  assert.equal(leela!.benefitKey, 'max_age_parents');
  assert.equal(leela!.isContinuation, true, 'already on cover, so a continuation');
  assert.match(leela!.detail, /continuation/);
});

check('a child above the child ceiling is flagged against the right benefit', () => {
  const nikhil = found.find((d) => d.memberId === 'm4');
  assert.ok(nikhil);
  assert.equal(nikhil!.benefitKey, 'max_age_children', 'children have their own ceiling');
  assert.equal(nikhil!.expectedValue, '25 years');
});

check('a sibling is flagged against the siblings benefit, not the general list', () => {
  const priya = found.find((d) => d.memberId === 'm5');
  assert.ok(priya);
  assert.equal(priya!.benefitKey, 'siblings', 'the specific term governs');
});

check('lives inside the terms raise nothing', () => {
  assert.ok(!found.some((d) => d.memberId === 'm1'));
  assert.ok(!found.some((d) => d.memberId === 'm2'));
  assert.ok(!found.some((d) => d.memberId === 'm6'), 'a 74-year-old parent is within 80');
});

check('checked against the RFQ instead, the same lives are not continuations', () => {
  const againstRfq = findDeviations(ROSTER, TERMS, 'rfq');
  assert.ok(againstRfq.every((d) => d.isContinuation === false));
  assert.equal(againstRfq.length, found.length, 'the same lives, a different ask');
});

check('an unreadable term raises nothing for the lives it governs', () => {
  const vague = findDeviations(
    ROSTER,
    { ...TERMS, max_age_parents: 'As per schedule', age_band: 'See policy' },
    'expiring_policy',
  );
  assert.ok(!vague.some((d) => d.benefitKey === 'max_age_parents'), 'no ceiling, no claim');
});

check('a life with no age is not assumed to be within the limits, or outside them', () => {
  const noAge = findDeviations(
    [{ id: 'x', relationship: 'parent', age: null, name: 'Unknown', employeeId: 'E9' }],
    TERMS,
    'expiring_policy',
  );
  assert.equal(noAge.length, 0);
});

check('the summary groups by benefit, not by life', () => {
  const summary = summariseDeviations(found);
  const parents = summary.find((s) => s.benefitKey === 'max_age_parents');
  assert.equal(parents?.count, 1);
  assert.equal(parents?.continuations, 1);
});

// ── burn ──────────────────────────────────────────────────────────────────
console.log('\nburn calculation');

const BURN = computeBurn({
  incurredClaims: 3_000_000,
  livesCovered: 400,
  livesQuoted: 412,
  monthsObserved: 12,
  ...BURN_DEFAULTS,
});

check('it computes', () => {
  assert.ok(BURN);
});

check('a full year is not rescaled', () => {
  assert.equal(BURN!.annualisedClaims, 3_000_000);
});

check('a part year is annualised', () => {
  const nineMonths = computeBurn({
    incurredClaims: 3_000_000,
    livesCovered: 400,
    livesQuoted: 412,
    monthsObserved: 9,
    ...BURN_DEFAULTS,
  });
  assert.equal(nineMonths!.annualisedClaims, 4_000_000);
});

check('IBNR grosses the claims up', () => {
  assert.equal(BURN!.claimsWithIbnr, 3_240_000); // 3,000,000 x 1.08
});

check('per life is against the lives ON COVER, not the lives quoted', () => {
  assert.equal(BURN!.perLifeClaimsCost, 8100); // 3,240,000 / 400
});

check('inflation is applied per life', () => {
  assert.equal(BURN!.inflatedPerLifeCost, 8910); // 8,100 x 1.10
});

check('expected claims use the lives being QUOTED', () => {
  assert.equal(BURN!.expectedClaims, 8910 * 412);
});

check('LOADINGS COME OUT OF THE PREMIUM, NOT ONTO THE CLAIMS', () => {
  // 30% combined. The premium is what expected claims become once 30% of it is
  // taken out — a division. Multiplying the claims by 1.3 is the common
  // mistake and understates the premium by about 10%.
  const expected = (8910 * 412) / 0.7;
  assert.ok(
    Math.abs(BURN!.indicativePremium - expected) < 0.01,
    `expected ${expected}, got ${BURN!.indicativePremium}`,
  );
  assert.ok(
    BURN!.indicativePremium > BURN!.expectedClaims * 1.3,
    'a premium loaded by division is higher than one loaded by multiplication',
  );
});

check('every step is shown, so the figure can be argued with', () => {
  assert.equal(BURN!.workings.length, 7);
  assert.equal(BURN!.workings[0]?.label, 'Claims incurred');
  assert.equal(BURN!.workings[6]?.label, 'Indicative premium');
});

check('a burn against no lives is refused, not returned as zero', () => {
  assert.equal(
    computeBurn({
      incurredClaims: 1000,
      livesCovered: 0,
      livesQuoted: 10,
      monthsObserved: 12,
      ...BURN_DEFAULTS,
    }),
    null,
  );
  assert.equal(
    computeBurn({
      incurredClaims: 1000,
      livesCovered: 10,
      livesQuoted: 10,
      monthsObserved: 0,
      ...BURN_DEFAULTS,
    }),
    null,
  );
});

check('loadings that consume the whole premium are refused', () => {
  assert.equal(
    computeBurn({
      incurredClaims: 1000,
      livesCovered: 10,
      livesQuoted: 10,
      monthsObserved: 12,
      ibnrPct: 0,
      inflationPct: 0,
      tpaFeePct: 50,
      brokeragePct: 30,
      insurerOpexPct: 20,
    }),
    null,
    'a 100% expense ratio has no premium that satisfies it',
  );
});

check('the movement against what is being paid now', () => {
  const up = comparedWithExpiring(5_000_000, 4_000_000);
  assert.equal(up?.changePct, 25);
  assert.equal(up?.direction, 'up');

  assert.equal(comparedWithExpiring(4_000_000, 4_000_000)?.direction, 'flat');
  assert.equal(comparedWithExpiring(5_000_000, null), null, 'nothing to compare against');
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall deviation and burn assertions passed.');
