/**
 * Reading a policy schedule without a model.
 *
 * The fixtures here are synthetic, but their SHAPES are taken from fifteen real
 * group health policies — three insurers, each of which broke the reader in its
 * own way. Every case below cost a debugging round, so each is named for what
 * it caught:
 *
 *   - a value in the next column, not after the label (ICICI Lombard)
 *   - a label row above a figure row (TATA AIG's premium)
 *   - a separator on a line of its own (ICICI Lombard)
 *   - the backtick their font uses for the rupee sign
 *   - four date formats, including month-first with a comma
 *   - dates printed either side of the "Policy Period" label
 *   - a ligature glyph that splits a word into two text items
 *
 * Run with `npm run test:policy-facts`.
 */
import assert from 'node:assert/strict';
import {
  findWordingStart,
  linesFromItems,
  repairLigatures,
  textLayerIsUsable,
} from '../../src/lib/parsing/pdf-text';
import { readPolicyFacts } from '../../src/lib/parsing/policy-facts';
import type { PdfText } from '../../src/lib/parsing/pdf-text';

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

function text(lines: string[][], wordingStartsAt: number | null = null): PdfText {
  return {
    pages: lines.map((l, i) => ({ page: i + 1, lines: l })),
    usable: true,
    wordingStartsAt,
  };
}

function facts(lines: string[][], wordingStartsAt: number | null = null) {
  const out = readPolicyFacts(text(lines, wordingStartsAt));
  assert.ok(out.ok, 'expected a readable policy');
  return out.facts;
}

console.log('\nputting the text back together');

check('a dropped ligature is put back', () => {
  // The font maps "fi" to a glyph whose ToUnicode entry is NUL, so pdf.js hands
  // back three items and the middle one is "\u0000". Left alone the word
  // reaches us as "Bene\u0000t Chart", which is invisible in a terminal and
  // matches no label.
  const lines = linesFromItems([
    { str: 'Bene', transform: [0, 0, 0, 0, 10, 700], width: 24 },
    { str: '\u0000', transform: [0, 0, 0, 0, 34, 700], width: 5 },
    { str: 't Chart', transform: [0, 0, 0, 0, 39, 700], width: 30 },
  ]);
  assert.equal(lines[0], 'Benefit Chart');
});

check('which ligature is decided by the letters around it', () => {
  const at = (before: string, after: string) => repairLigatures(`${before}\u0000${after}`);

  assert.equal(at('Waived o', ' the waiting period'), 'Waived off the waiting period');
  assert.equal(at('Issuing O', 'ce'), 'Issuing Office');
  assert.equal(at('with e', 'ect from'), 'with effect from');
  assert.equal(at('Speci', 'ed illness'), 'Specified illness', 'fi is the common case');
});

check('a wide gap is a column break, not a space', () => {
  const lines = linesFromItems([
    { str: 'Sum Insured', transform: [0, 0, 0, 0, 10, 700], width: 50 },
    { str: '5,00,000', transform: [0, 0, 0, 0, 300, 700], width: 40 },
  ]);
  assert.equal(lines[0], 'Sum Insured\t5,00,000', 'the columns stay apart');
});

console.log('\nwhere the filed wording starts');

check('a heading with a long section behind it is the boundary', () => {
  const pages = [
    { page: 1, lines: ['Schedule'] },
    { page: 2, lines: ['Benefits'] },
    { page: 3, lines: ['Policy Wordings'] },
    ...Array.from({ length: 10 }, (_, i) => ({ page: 4 + i, lines: ['Standard clause'] })),
  ];
  assert.equal(findWordingStart(pages), 3);
});

check('a heading with almost nothing behind it is not', () => {
  // Bajaj attaches no filed wording; a "Disclaimer" on page 3 of 4 once threw
  // away the schedule.
  const pages = [
    { page: 1, lines: ['Policy Benefit Chart'] },
    { page: 2, lines: ['Benefits continued'] },
    { page: 3, lines: ['Disclaimer :'] },
    { page: 4, lines: ['More benefits'] },
  ];
  assert.equal(findWordingStart(pages), null, 'four pages is not a filed wording');
});

check('page one never starts the wording', () => {
  // "Scan to Download Policy Wordings." is a TATA AIG page-one footer, and
  // matching it cut a 21-page document to nothing.
  assert.equal(findWordingStart([{ page: 1, lines: ['Policy Wordings'] }]), null);
});

check('a text layer of symbols is refused', () => {
  // One of the fifteen has no ToUnicode map, so every glyph decodes to
  // punctuation. It is a text PDF, so a "is it scanned?" check passes it.
  assert.equal(textLayerIsUsable("$% #\t ') *'+ '+ ! #$! , ! $&'(-('# !".repeat(20)), false);
  assert.equal(textLayerIsUsable('Sum Insured five lakh rupees per family '.repeat(20)), true);
});

check('the usability gate reads the raw text, not the repaired text', () => {
  // Repair substitutes letters for control characters. Run on repaired text, a
  // document of pure control characters would be "fixed" into prose — exactly
  // the document the gate exists to reject.
  const garbage = '\u0000'.repeat(400);
  assert.equal(textLayerIsUsable(garbage), false);
  assert.ok(/^(fi)+$/.test(repairLigatures(garbage)), 'which is what repair would make of it');
});

console.log('\nreading the schedule');

check('a value in the next column', () => {
  const f = facts([['Sum Insured\t`12,05,00,000.00']]);
  assert.equal(f.sumInsured?.value, 120500000);
});

check('a separator on its own line', () => {
  const f = facts([['Total Lives Insured', ':', '766']]);
  assert.equal(f.lives?.value, 766);
});

check('a label row above a figure row', () => {
  const f = facts([['Net Premium ( ₹ )\tAdd: Applicable Taxes ( ₹ )', '8237375\t1482727.5']]);
  assert.equal(f.premium?.value, 8237375, 'the figure is on the line beneath its label');
});

check('a colon glued to the value', () => {
  const f = facts([['Total Lives Insured', ': 766']]);
  assert.equal(f.lives?.value, 766);
});

check('dates printed either side of the label', () => {
  const f = facts([['From 08/04/2026', 'Policy Period', 'To 07/04/2027']]);
  assert.equal(f.policyStart?.value, '2026-04-08');
  assert.equal(f.policyEnd?.value, '2027-04-07');
});

check('month-first dates with a comma', () => {
  const f = facts([
    ['Period of Insurance', ': From: 00:00 Hours of Mar 28, 2026 To Midnight Mar 27, 2027'],
  ]);
  assert.equal(f.policyStart?.value, '2026-03-28');
  assert.equal(f.policyEnd?.value, '2027-03-27');
});

check('a GSTIN with no label at all', () => {
  const f = facts([
    ['Registered office: somewhere', 'CIN: U85110MH2000PLC128425 GSTIN 33AAKCC0146L1ZR'],
  ]);
  assert.equal(f.gstin?.value, '33AAKCC0146L1ZR');
});

check('the insurer names itself in its letterhead', () => {
  const f = facts([['TATA AIG General Insurance Company Limited', 'Group Medicare']]);
  assert.equal(f.insurerName?.value, 'Tata AIG');
});

check('the TPA, however it is labelled', () => {
  assert.equal(
    facts([['Claims Administrator\tTATA AIG CORPORATE HEALTH CLAIMS']]).tpaName?.value,
    'TATA AIG CORPORATE HEALTH CLAIMS',
  );
  assert.equal(
    facts([['Third Party Administrator\tICICI Lombard Healthcare']]).tpaName?.value,
    'ICICI Lombard Healthcare',
  );
});

check('the broker, however it is labelled', () => {
  assert.equal(
    facts([['Intermediary Name\tPLUM BENEFITS INSURANCE BROKERS PRIVATE LIMITED']]).brokerName
      ?.value,
    'PLUM BENEFITS INSURANCE BROKERS PRIVATE LIMITED',
  );
});

console.log('\nwhat it refuses to do');

check('every fact carries the line it was read from', () => {
  const f = facts([['Sum Insured\t`5,00,000']]);
  assert.match(f.sumInsured!.evidence, /Sum Insured/, 'traceable, like an extracted term');
  assert.equal(f.sumInsured!.page, 1);
});

check('the filed wording is not read', () => {
  // The wording defines every one of these words. Reading it would replace a
  // real figure with a sentence about what the word means.
  const f = facts(
    [
      ['Schedule with nothing stated'],
      ['Policy Wordings'],
      ['Sum Insured\t9,99,99,999'],
      ['Standard clause'],
      ['Standard clause'],
      ['Standard clause'],
      ['Standard clause'],
    ],
    2,
  );
  assert.equal(f.sumInsured, null, 'a definition is not a value');
});

check('an unreadable text layer reports rather than guesses', () => {
  const out = readPolicyFacts({
    pages: [{ page: 1, lines: ['###'] }],
    usable: false,
    wordingStartsAt: null,
  });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.message, /text layer/i);
});

check('nothing is invented when the document does not say', () => {
  // The Bajaj copies are benefit charts, not schedules: no premium, no GSTIN,
  // no sum insured anywhere in them.
  const f = facts([['Policy Benefit Chart', 'Relation\tCoverage\tLimit']]);
  assert.equal(f.premium, null);
  assert.equal(f.gstin, null);
  assert.equal(f.sumInsured, null);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall policy fact assertions passed.');
