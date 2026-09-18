/**
 * Reading a spreadsheet somebody else made.
 *
 * Member rosters and claims dumps arrive as whatever the client's HR system or
 * the insurer's MIS produced. They are not a format; they are a genre. This
 * layer turns one into a list of rows keyed by header, and everything above it
 * works on that rather than on cells.
 */
import ExcelJS from 'exceljs';

export type SheetRow = Record<string, unknown>;

export type Sheet = {
  name: string;
  headers: string[];
  rows: SheetRow[];
  /** Which row of the file the headers were on, 1-based, for error messages. */
  headerRow: number;
};

/** Trimmed, collapsed, lowercased — for comparing headers, never for display. */
export function normaliseHeader(value: unknown): string {
  return (
    String(value ?? '')
      .replace(/[\u00a0\s]+/g, ' ')
      .trim()
      .toLowerCase()
      // Dots are punctuation inside a header, not separators. Turning them into
      // spaces made "D.O.B" into "d o b", which matched nothing — so every date
      // on a roster using that spelling was read as missing.
      .replace(/\./g, '')
      .replace(/_+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;

  // ExcelJS hands back objects for formulas, hyperlinks and rich text. What is
  // wanted in every case is the text a human would see in the cell.
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return (v as { result: unknown }).result ?? null;
    if ('text' in v) return (v as { text: unknown }).text ?? null;
    if ('richText' in v) {
      return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
    }
    if ('hyperlink' in v) return (v as { text?: string }).text ?? null;
    return null;
  }

  return v;
}

/**
 * Finds the row the headers are on.
 *
 * Rosters routinely open with a title, a logo row, a blank line and a note
 * before the table starts, so assuming row 1 fails on a large share of real
 * files. The header row is taken to be the first row in the first fifteen that
 * has at least three non-empty cells and no cell that looks like a pure number
 * — a data row that happens to sit above the headers is rare, whereas a title
 * row with one cell is common.
 */
function findHeaderRow(rows: unknown[][]): number {
  // A label/value file is two columns wide and has no header row to find, so
  // the three-cell rule only applies to files wide enough to have one.
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width < 3) return 0;

  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const cells = (rows[i] ?? []).filter((c) => String(c ?? '').trim() !== '');
    if (cells.length < 3) continue;

    const numeric = cells.filter((c) => typeof c === 'number' || /^\d+(\.\d+)?$/.test(String(c)));
    if (numeric.length > cells.length / 2) continue;

    return i;
  }
  return 0;
}

/** Makes headers unique, because duplicates silently lose a column otherwise. */
function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = String(h ?? '').trim() || `column ${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

function toSheet(name: string, grid: unknown[][]): Sheet {
  const headerRow = findHeaderRow(grid);

  /*
   * Headers are padded to the widest row in the file, not to the width of the
   * header row itself.
   *
   * An MIS is usually two columns of label and value under a one-cell title.
   * Taking the header row's width literally made that file one column wide and
   * threw away every figure in it.
   */
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const headerCells = [...(grid[headerRow] ?? [])];
  while (headerCells.length < width) headerCells.push(null);

  const headers = uniqueHeaders(headerCells);

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const cells = grid[r] ?? [];
    const row: SheetRow = {};
    let hasValue = false;

    headers.forEach((h, c) => {
      const v = cells[c] ?? null;
      row[h] = v;
      if (v !== null && String(v).trim() !== '') hasValue = true;
    });

    // Blank rows are everywhere in these files — spacers, totals separators,
    // the gap before a footnote. A row with nothing in it is not a member.
    if (hasValue) rows.push(row);
  }

  return { name, headers, rows, headerRow: headerRow + 1 };
}

/**
 * Splits a CSV line, honouring quotes.
 *
 * Hand-rolled rather than adding a dependency: the grammar is small, and the
 * one case that matters is a quoted field containing a comma, which a naive
 * split gets wrong on exactly the files that matter — names and diagnoses.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }

  out.push(field);
  return out;
}

export function parseCsv(text: string, name = 'CSV'): Sheet {
  // A byte-order mark on the first header turns "Employee ID" into something
  // that matches nothing, which presents as "no columns recognised".
  const cleaned = text.replace(/^﻿/, '');

  const lines = cleaned
    .split(/\r\n|\n|\r/)
    .filter((l, i, all) => l.trim() !== '' || i < all.length);
  const grid = lines.filter((l) => l.trim() !== '').map((line) => splitCsvLine(line));

  return toSheet(name, grid);
}

export async function parseWorkbook(buffer: ArrayBuffer): Promise<Sheet[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets: Sheet[] = [];
  workbook.eachSheet((worksheet) => {
    const grid: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: unknown[] = [];
      // `row.eachCell` skips empty cells, which shifts every column after a
      // gap. Indexing by column number keeps the grid rectangular.
      for (let c = 1; c <= worksheet.columnCount; c += 1) {
        cells.push(cellValue(row.getCell(c)));
      }
      grid.push(cells);
    });

    sheets.push(toSheet(worksheet.name, grid));
  });

  return sheets;
}

/** The sheet with the most rows: in a multi-tab file, the data is the big one. */
export function largestSheet(sheets: Sheet[]): Sheet | null {
  if (sheets.length === 0) return null;
  return sheets.reduce((best, s) => (s.rows.length > best.rows.length ? s : best));
}
