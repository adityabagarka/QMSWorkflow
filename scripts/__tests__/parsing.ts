/**
 * The spreadsheet parsers, against files shaped like the ones that arrive.
 *
 * Every fixture here is synthetic (CLAUDE.md: no real PII or PHI in this
 * environment, ever) but the SHAPES are real: a title row above the headers,
 * lakh-grouped amounts, a stale age column, dd/mm/yyyy dates, dependents whose
 * employee is missing, and an MIS that is label-then-value rather than a table.
 *
 * Run with `npm run test:parsing`.
 */
import assert from 'node:assert/strict';
import { parseCsv } from '../../src/lib/parsing/sheet';
import { parseAmount, parseDate, parseRelationship, ageOn } from '../../src/lib/parsing/values';
import { matchColumns, MEMBER_FIELDS, CLAIM_FIELDS } from '../../src/lib/parsing/columns';
import { readRoster, summariseRoster } from '../../src/lib/parsing/roster';
import { readClaims, readMis, findDiscrepancies } from '../../src/lib/parsing/claims';

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

const COVER_START = '2026-11-01';

// ── values ────────────────────────────────────────────────────────────────
console.log('\nvalues');

check('an Indian date is read day-first, and says it assumed so', () => {
  const r = parseDate('03/04/1990');
  assert.equal(r.iso, '1990-04-03');
  assert.equal(r.ambiguity, 'day_first_assumed');
});

check('a date that can only be day-first is not flagged', () => {
  const r = parseDate('25/12/1988');
  assert.equal(r.iso, '1988-12-25');
  assert.equal(r.ambiguity, null);
});

check('a date that can only be month-first is read that way', () => {
  assert.equal(parseDate('04/25/1988').iso, '1988-04-25');
});

check('an Excel serial becomes a date', () => {
  // 33604 days after Excel's 1899-12-30 epoch. Verified by computing it
  // rather than by trusting the first number that looked plausible.
  assert.equal(parseDate(33604).iso, '1992-01-01');
});

check('an impossible date is refused rather than rolled forward', () => {
  assert.equal(parseDate('31/02/1990').iso, null);
});

check('a two-digit year lands in the plausible century', () => {
  assert.equal(parseDate('14/03/88').iso, '1988-03-14');
  assert.equal(parseDate('14/03/05').iso, '2005-03-14');
});

check('a named month parses either way round', () => {
  assert.equal(parseDate('14 Mar 1990').iso, '1990-03-14');
  assert.equal(parseDate('Mar 14, 1990').iso, '1990-03-14');
});

check('lakh grouping and a rupee symbol', () => {
  assert.equal(parseAmount('₹1,20,000'), 120000);
  assert.equal(parseAmount('Rs. 41,20,000'), 4120000);
  assert.equal(parseAmount('(2,500)'), -2500);
});

check('an unreadable amount is null, never zero', () => {
  assert.equal(parseAmount('not available'), null);
  assert.equal(parseAmount(''), null);
});

check('relationships, including the in-law trap', () => {
  assert.equal(parseRelationship('Self'), 'self');
  assert.equal(parseRelationship('WIFE'), 'spouse');
  assert.equal(parseRelationship('Daughter'), 'child');
  assert.equal(parseRelationship('Mother'), 'parent');
  // "father-in-law" contains "father" — order in the table matters.
  assert.equal(parseRelationship('Father-in-law'), 'parent_in_law');
  assert.equal(parseRelationship('Brother'), 'sibling');
  assert.equal(parseRelationship('Nephew'), null);
});

check('age is whole years at cover start, not today', () => {
  assert.equal(ageOn('1990-11-02', COVER_START), 35);
  assert.equal(ageOn('1990-11-01', COVER_START), 36);
});

// ── column matching ───────────────────────────────────────────────────────
console.log('\ncolumn matching');

check('"Employee Name" does not become the employee id', () => {
  const m = matchColumns(['Emp Code', 'Employee Name', 'Relation', 'D.O.B'], MEMBER_FIELDS);
  const by = (f: string) => m.matches.find((x) => x.field === f)?.header;
  assert.equal(by('employee_id'), 'Emp Code');
  assert.equal(by('name'), 'Employee Name');
  assert.equal(by('relationship'), 'Relation');
  assert.equal(by('dob'), 'D.O.B');
});

check('a header nothing claims is reported rather than dropped silently', () => {
  const m = matchColumns(['Relation', 'Branch Location'], MEMBER_FIELDS);
  assert.deepEqual(m.unmatched, ['Branch Location']);
});

check('claim columns', () => {
  const m = matchColumns(
    [
      'Claim No',
      'Member ID',
      'Claim Status',
      'Date of Admission',
      'Claimed Amount',
      'Settled Amount',
    ],
    CLAIM_FIELDS,
  );
  const by = (f: string) => m.matches.find((x) => x.field === f)?.header;
  assert.equal(by('claim_ref'), 'Claim No');
  assert.equal(by('status'), 'Claim Status');
  assert.equal(by('incurred_on'), 'Date of Admission');
  assert.equal(by('claimed_amount'), 'Claimed Amount');
  assert.equal(by('paid_amount'), 'Settled Amount');
});

// ── roster ────────────────────────────────────────────────────────────────
console.log('\nroster');

const ROSTER = `Synthetic Manufacturing Pvt Ltd — GMC roster 2026
Prepared by HR

Emp Code,Employee Name,Relation,Gender,D.O.B,Age,Sum Insured
E001,Asha Rao,Self,F,12/05/1985,41,"5,00,000"
E001,Ravi Rao,Spouse,M,03/04/1987,39,"5,00,000"
E001,Ira Rao,Daughter,F,21/09/2015,11,"5,00,000"
E002,Vikram Shah,Self,M,30/11/1979,46,"5,00,000"
E002,Leela Shah,Mother,F,02/02/1944,82,"5,00,000"
E003,No Such Employee,Spouse,F,14/07/1990,36,"5,00,000"
E004,Priya Menon,Self,F,08/08/1992,20,"5,00,000"
,Blank Relation,,F,01/01/1980,46,"5,00,000"
`;

const roster = readRoster(parseCsv(ROSTER, 'roster'), COVER_START);

check('the header row is found under a title and a blank line', () => {
  assert.equal(roster.mapping.matches.find((m) => m.field === 'employee_id')?.header, 'Emp Code');
});

check('readable rows are read', () => {
  // Eight data rows; the blank-relation row and the orphan spouse are blocked.
  assert.equal(roster.counts.rows, 8);
  assert.equal(roster.counts.read, 6);
});

check('a dependent with no employee on the roster is a hard error', () => {
  const issue = roster.issues.find((i) => i.code === 'dependent_without_employee');
  assert.ok(issue, 'expected the orphan dependent to be caught');
  assert.equal(issue?.blocking, true);
});

check('an unreadable relationship blocks that row and only that row', () => {
  const issue = roster.issues.find((i) => i.code === 'relationship_unreadable');
  assert.ok(issue);
  assert.equal(issue?.blocking, true);
});

check('a stale age column is flagged, not silently trusted', () => {
  // Priya's file age says 20; her date of birth gives 34 at cover start.
  const issue = roster.issues.find((i) => i.code === 'age_disagrees_with_dob');
  assert.ok(issue, 'expected the age/DOB disagreement to be caught');
});

check('the day-first assumption is surfaced once, not per row', () => {
  assert.ok(roster.assumptions.some((a) => a.includes('day first')));
});

check('an 82-year-old parent is kept, not dropped — eligibility is not this layer', () => {
  const leela = roster.members.find((m) => m.name === 'Leela Shah');
  assert.ok(leela, 'the parent must still be on the roster');
  assert.equal(leela?.age, 82);
  assert.equal(leela?.relationship, 'parent');
});

check('the demography summary bands the lives', () => {
  const s = summariseRoster(roster.members);
  assert.equal(s.lives, 6);
  assert.equal(s.byRelationship.self, 3);
  assert.equal(s.byAgeBand['76+'], 1);
  assert.equal(s.withoutAge, 0);
});

check('a duplicated life is flagged', () => {
  const dup = readRoster(
    parseCsv(`Emp Code,Employee Name,Relation,D.O.B\nE1,A,Self,01/01/1990\nE1,A,Self,01/01/1990\n`),
    COVER_START,
  );
  assert.ok(dup.issues.some((i) => i.code === 'duplicate_member'));
});

// ── claims ────────────────────────────────────────────────────────────────
console.log('\nclaims');

const CLAIMS = `Claim No,Member ID,Claim Status,Date of Admission,Claimed Amount,Settled Amount
C001,E001,Settled,14/02/2026,"1,20,000","95,000"
C002,E002,Settled,02/06/2026,"80,000","80,000"
C003,E001,Outstanding,20/08/2026,"2,50,000",
C004,E004,Repudiated,11/09/2026,"40,000",0
,,,,,
`;

const claims = readClaims(parseCsv(CLAIMS, 'claims'));

check('claim rows are read and the spacer row is not a claim', () => {
  assert.equal(claims.claims.length, 4);
  assert.equal(claims.computed.claimsReported, 4);
});

check('settled, outstanding and rejected are told apart', () => {
  assert.equal(claims.computed.claimsSettled, 2);
  assert.equal(claims.computed.claimsOutstanding, 1);
  assert.equal(claims.computed.claimsRejected, 1);
});

check('a settled claim counts what was paid; an outstanding one counts exposure', () => {
  assert.equal(claims.computed.amountSettled, 175000);
  assert.equal(claims.computed.amountOutstanding, 250000);
});

check('the ratio needs a premium and says so rather than guessing', () => {
  assert.equal(claims.computed.incurredClaimsRatio, null);
});

// ── MIS, and the disagreement ─────────────────────────────────────────────
console.log('\nMIS reconciliation');

const MIS = `Claims MIS — synthetic
Policy period,01/11/2025 to 31/10/2026

Claims reported,4
Claims settled,2
Amount settled,"1,75,000"
Amount outstanding,"3,10,000"
Premium,"41,20,000"
`;

const mis = readMis(parseCsv(MIS, 'mis'));

check('label-then-value figures are read out of an MIS', () => {
  const by = (m: string) => mis.figures.find((f) => f.metric === m)?.value;
  assert.equal(by('claims_reported'), 4);
  assert.equal(by('claims_settled'), 2);
  assert.equal(by('amount_settled'), 175000);
  assert.equal(by('premium'), 4120000);
});

check('figures that agree raise nothing', () => {
  const gaps = findDiscrepancies(mis.figures, claims.computed);
  assert.ok(!gaps.some((g) => g.metric === 'amount_settled'), 'settled amounts agree');
  assert.ok(!gaps.some((g) => g.metric === 'claims_reported'));
});

check('a figure that disagrees is surfaced with both numbers, and nothing is chosen', () => {
  const gaps = findDiscrepancies(mis.figures, claims.computed);
  const outstanding = gaps.find((g) => g.metric === 'amount_outstanding');

  assert.ok(outstanding, 'the outstanding amounts differ and must be surfaced');
  assert.equal(outstanding?.stated, 310000);
  assert.equal(outstanding?.computed, 250000);
  // Both are reported; the RM decides (ADR 0011 rule 5).
  assert.ok(outstanding!.gapPercent < 0, 'ours is lower than theirs');
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall parsing assertions passed.');
