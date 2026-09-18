import ExcelJS from 'exceljs';
import type { Assembled } from './assemble';

/**
 * The RFQ as a workbook.
 *
 * This is the artefact that leaves the building. An insurer reads it, quotes
 * from it, and — once an option is agreed — issues a policy from the terms in
 * it. So every benefit carries its full value rather than a reference back to
 * another column: "same as expiring" is fine on a screen where the expiring
 * column is two inches away, and useless in a file that gets forwarded,
 * filtered and pasted into somebody else's system.
 */

const CREAM = 'FFFFFAF2';
const WARM = 'FFF7E9D8';
const PLUM = 'FF3A0E2B';
const RED = 'FFFF4052';

const METRIC_LABELS: Record<string, string> = {
  claims_reported: 'Claims reported',
  claims_settled: 'Claims settled',
  claims_outstanding: 'Claims outstanding',
  claims_rejected: 'Claims rejected',
  amount_claimed: 'Amount claimed',
  amount_settled: 'Amount settled',
  amount_outstanding: 'Amount outstanding',
  premium: 'Premium',
  incurred_claims_ratio: 'Incurred claims ratio (%)',
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Employees',
  spouse: 'Spouses',
  child: 'Children',
  parent: 'Parents',
  parent_in_law: 'Parents-in-law',
  sibling: 'Siblings',
};

function heading(sheet: ExcelJS.Worksheet, row: number, text: string, span = 4) {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 11, color: { argb: PLUM } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARM } };
  sheet.mergeCells(row, 1, row, span);
}

function labelled(sheet: ExcelJS.Worksheet, row: number, label: string, value: unknown) {
  sheet.getCell(row, 1).value = label;
  sheet.getCell(row, 1).font = { color: { argb: PLUM }, bold: true };
  sheet.getCell(row, 2).value = (value ?? '—') as ExcelJS.CellValue;
}

export async function buildRfqWorkbook(rfq: Assembled): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Plum';
  workbook.created = new Date(rfq.assembledAt);

  // ── The ask ─────────────────────────────────────────────────────────────
  const brief = workbook.addWorksheet('Request', {
    properties: { defaultColWidth: 26 },
    views: [{ showGridLines: false }],
  });

  brief.getColumn(1).width = 30;
  brief.getColumn(2).width = 46;

  heading(brief, 1, 'Request for quotation', 2);
  labelled(brief, 3, 'Company', rfq.customer.brandName);
  labelled(brief, 4, 'Legal name', rfq.customer.legalName);
  labelled(brief, 5, 'GSTIN', rfq.customer.gstin);
  labelled(brief, 6, 'Location', rfq.customer.location);
  labelled(brief, 8, 'Cover starts', rfq.cover.startsOn);
  labelled(brief, 9, 'Incumbent insurer', rfq.cover.incumbent);
  labelled(brief, 10, 'Expiring premium (excluding GST)', rfq.cover.expiringPremium ?? '—');
  labelled(
    brief,
    12,
    'Option quoted',
    rfq.option ? `${rfq.option.optionNo}. ${rfq.option.name}` : '—',
  );
  labelled(brief, 13, 'Lives', rfq.demography.lives);

  brief.getCell(15, 1).value = 'All premiums in this request and in any response exclude GST.';
  brief.getCell(15, 1).font = { italic: true, color: { argb: PLUM } };
  brief.mergeCells(15, 1, 15, 2);

  // ── Terms ───────────────────────────────────────────────────────────────
  const terms = workbook.addWorksheet('Terms', { views: [{ state: 'frozen', ySplit: 1 }] });

  terms.columns = [
    { header: 'Section', key: 'section', width: 26 },
    { header: 'Benefit', key: 'benefit', width: 34 },
    { header: 'Expiring policy', key: 'expiring', width: 34 },
    {
      header: rfq.option ? `Option ${rfq.option.optionNo}: ${rfq.option.name}` : 'Requested',
      key: 'value',
      width: 34,
    },
    { header: 'Changed', key: 'changed', width: 12 },
  ];

  terms.getRow(1).font = { bold: true, color: { argb: PLUM } };
  terms.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARM } };

  for (const term of rfq.terms) {
    const row = terms.addRow({
      section: term.section,
      benefit: term.label,
      expiring: term.expiring ?? 'Not stated',
      value: term.value ?? 'Not stated',
      changed: term.changed ? 'Changed' : '',
    });

    row.alignment = { vertical: 'top', wrapText: true };

    // Marked by fill AND by the word "Changed", because a fill does not
    // survive being pasted into another system and a colour alone excludes
    // anyone who cannot distinguish it.
    if (term.changed) {
      for (const col of [3, 4, 5]) {
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARM } };
      }
      row.getCell(5).font = { bold: true, color: { argb: RED } };
    }
  }

  // ── Who is covered ──────────────────────────────────────────────────────
  const demography = workbook.addWorksheet('Demography');
  demography.columns = [
    { header: 'Group', key: 'group', width: 26 },
    { header: 'Lives', key: 'lives', width: 12 },
  ];
  demography.getRow(1).font = { bold: true, color: { argb: PLUM } };

  for (const [relationship, count] of Object.entries(rfq.demography.byRelationship)) {
    demography.addRow({ group: RELATIONSHIP_LABELS[relationship] ?? relationship, lives: count });
  }

  demography.addRow({});
  demography.addRow({ group: 'Total lives', lives: rfq.demography.lives }).font = { bold: true };
  demography.addRow({ group: 'Average age', lives: rfq.demography.averageAge ?? '—' });
  demography.addRow({});

  const bandHeader = demography.addRow({ group: 'Age band', lives: 'Lives' });
  bandHeader.font = { bold: true, color: { argb: PLUM } };
  for (const [band, count] of Object.entries(rfq.demography.byAgeBand)) {
    demography.addRow({ group: band, lives: count });
  }

  // ── Claims ──────────────────────────────────────────────────────────────
  const claims = workbook.addWorksheet('Claims history');
  claims.columns = [
    { header: 'Figure', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 18 },
    { header: 'Source', key: 'source', width: 40 },
  ];
  claims.getRow(1).font = { bold: true, color: { argb: PLUM } };

  for (const figure of rfq.claims) {
    claims.addRow({
      metric: METRIC_LABELS[figure.metric] ?? figure.metric,
      value: figure.value,
      // Said plainly: where a figure was disputed and settled, the insurer can
      // see that it was — which is the honest way to send a number that
      // differs from the one they themselves reported.
      source:
        figure.source === 'chosen'
          ? 'Agreed after reconciling the MIS against the claims dump'
          : 'Computed from the claims dump',
    });
  }

  // ── Deviations ──────────────────────────────────────────────────────────
  if (rfq.deviations.length > 0) {
    const dev = workbook.addWorksheet('Member exceptions');
    dev.columns = [
      { header: 'Benefit', key: 'benefit', width: 30 },
      { header: 'Lives', key: 'count', width: 10 },
      { header: 'Continuation', key: 'continuation', width: 16 },
      { header: 'Detail', key: 'detail', width: 70 },
    ];
    dev.getRow(1).font = { bold: true, color: { argb: PLUM } };

    for (const d of rfq.deviations) {
      const row = dev.addRow({
        benefit: d.benefitKey,
        count: d.count,
        // A continuation is a different ask from admitting a new life outside
        // the limits — the insurer already carries these people.
        continuation: d.isContinuation ? 'Yes' : 'No',
        detail: d.detail,
      });
      row.alignment = { vertical: 'top', wrapText: true };
    }
  }

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).height = 20;
    if (sheet.name !== 'Request')
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** A filename a person can find again in a folder of forty of them. */
export function workbookName(rfq: Assembled): string {
  const company = rfq.customer.brandName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const date = rfq.assembledAt.slice(0, 10);
  const option = rfq.option ? `-option-${rfq.option.optionNo}` : '';
  return `RFQ-${company || 'deal'}${option}-${date}.xlsx`;
}
