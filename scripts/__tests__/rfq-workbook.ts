/**
 * The RFQ workbook, read back after writing.
 *
 * This is the file that leaves the building — an insurer quotes from it and
 * issues a policy from the option that gets agreed. So the test writes one,
 * reads it back with a fresh reader, and checks what an insurer would actually
 * see, rather than checking that the code ran.
 *
 * Run with `npm run test:rfq`.
 */
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildRfqWorkbook, workbookName } from '../../src/lib/rfq/workbook';
import type { Assembled } from '../../src/lib/rfq/assemble';

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

const RFQ: Assembled = {
  customer: {
    brandName: 'Meridian',
    legalName: 'Meridian Synthetic Logistics Private Limited',
    gstin: '27AABCM1234N1Z5',
    location: 'Pune, Maharashtra',
  },
  cover: { startsOn: '2026-11-01', expiringPremium: 4120000, incumbent: 'Synthetic General' },
  option: { id: 'o2', optionNo: 2, name: 'Enhanced maternity & room' },
  terms: [
    {
      benefitKey: 'sum_insured',
      section: 'Sum insured, limits & copay',
      label: 'Sum Insured',
      expiring: 'Rs 5,00,000',
      value: 'Rs 5,00,000',
      changed: false,
    },
    {
      benefitKey: 'maternity_cover',
      section: 'Mother & Child',
      label: 'Maternity Cover',
      expiring: 'Up to Rs 50,000',
      value: 'Up to Rs 75,000',
      changed: true,
    },
    {
      benefitKey: 'room_rent',
      section: 'Sum insured, limits & copay',
      label: 'Room rent',
      expiring: null,
      value: 'Single private AC room',
      changed: true,
    },
  ],
  demography: {
    lives: 412,
    byRelationship: { self: 150, spouse: 120, child: 100, parent: 42 },
    byAgeBand: { '18–35': 200, '36–45': 150, '76+': 4 },
    averageAge: 34.2,
    withoutAge: 0,
  },
  claims: [
    { metric: 'amount_settled', value: 175000, source: 'computed' },
    { metric: 'amount_outstanding', value: 275000, source: 'chosen' },
  ],
  deviations: [
    {
      benefitKey: 'max_age_parents',
      detail: 'Parents above the 80-year ceiling, already on the expiring policy.',
      isContinuation: true,
      count: 11,
    },
  ],
  assembledAt: '2026-09-18T09:00:00.000Z',
};

async function read(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

async function main() {
  console.log('\nRFQ workbook');

  const buffer = await buildRfqWorkbook(RFQ);
  const wb = await read(buffer);

  await check('it is a workbook a spreadsheet program can open', () => {
    assert.ok(buffer.length > 1000, 'suspiciously small for a workbook');
    assert.ok(wb.worksheets.length >= 4);
  });

  await check('the sheets an insurer needs are all there', () => {
    const names = wb.worksheets.map((w) => w.name);
    for (const expected of ['Request', 'Terms', 'Demography', 'Claims history']) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });

  await check('every benefit carries its full value, never a cross-reference', () => {
    const terms = wb.getWorksheet('Terms')!;
    const values: string[] = [];
    terms.eachRow((row, i) => {
      if (i > 1) values.push(String(row.getCell(4).value ?? ''));
    });

    assert.equal(values.length, 3);
    // The unchanged benefit repeats its value rather than pointing sideways.
    assert.equal(values[0], 'Rs 5,00,000');
    assert.ok(!values.some((v) => /same as/i.test(v)), 'no cross-references in the export');
  });

  await check('a changed term says so in words, not only in colour', () => {
    const terms = wb.getWorksheet('Terms')!;
    const changed: string[] = [];
    terms.eachRow((row, i) => {
      if (i > 1) changed.push(String(row.getCell(5).value ?? ''));
    });
    assert.deepEqual(changed, ['', 'Changed', 'Changed']);
  });

  await check('a term the expiring policy never stated is not left blank', () => {
    const terms = wb.getWorksheet('Terms')!;
    assert.equal(terms.getRow(4).getCell(3).value, 'Not stated');
  });

  await check('the option being quoted is named on the request and the column', () => {
    const request = wb.getWorksheet('Request')!;
    const found = String(request.getCell(12, 2).value ?? '');
    assert.match(found, /2\. Enhanced maternity/);

    const terms = wb.getWorksheet('Terms')!;
    assert.match(String(terms.getRow(1).getCell(4).value ?? ''), /Option 2/);
  });

  await check('GST is stated once, on the request', () => {
    const request = wb.getWorksheet('Request')!;
    const text = String(request.getCell(15, 1).value ?? '');
    assert.match(text, /exclude GST/);
  });

  await check('a reconciled claims figure says it was reconciled', () => {
    const claims = wb.getWorksheet('Claims history')!;
    const sources: string[] = [];
    claims.eachRow((row, i) => {
      if (i > 1) sources.push(String(row.getCell(3).value ?? ''));
    });
    assert.equal(sources.length, 2);
    assert.match(String(sources[0]), /Computed from the claims dump/);
    assert.match(String(sources[1]), /reconcil/i);
  });

  await check('member exceptions travel as continuations, grouped', () => {
    const dev = wb.getWorksheet('Member exceptions')!;
    assert.equal(dev.getRow(2).getCell(2).value, 11, 'grouped, not eleven rows');
    assert.equal(dev.getRow(2).getCell(3).value, 'Yes', 'the insurer already carries these lives');
  });

  await check('the demography totals', () => {
    const d = wb.getWorksheet('Demography')!;
    const rows: [string, unknown][] = [];
    d.eachRow((row) => rows.push([String(row.getCell(1).value ?? ''), row.getCell(2).value]));
    const total = rows.find(([label]) => label === 'Total lives');
    assert.ok(total, 'a total an underwriter can check against the roster');
    assert.equal(total![1], 412);
  });

  await check('the filename says who, which option, and when', () => {
    assert.equal(workbookName(RFQ), 'RFQ-Meridian-option-2-2026-09-18.xlsx');
  });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nthe RFQ workbook says what an insurer needs.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
