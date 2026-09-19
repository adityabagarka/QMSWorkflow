/**
 * Getting readable text out of a policy PDF.
 *
 * Written against fifteen real group health policies from three insurers, each
 * of which broke a naive reader in its own way. Three things here are not
 * optional:
 *
 *  1. Items are joined by their x positions, not with spaces, and ligatures are
 *     put back. The fi/ff ligatures arrive as their own text item mapped to a
 *     NUL character, so "Benefit" reaches us as "Bene\u0000t" — which is
 *     invisible in a terminal and matches no label at all.
 *  2. A wide gap between items is a column boundary, not a word space. The
 *     schedules are two-column tables and without this a label and its value
 *     from different columns run together into one sentence.
 *  3. A text layer can decode to punctuation. One of the fifteen has no
 *     ToUnicode map, so every glyph comes back as symbols; it is a text PDF, so
 *     a "is it scanned?" check passes and the parser would produce confident
 *     nonsense. That has to be detected, not discovered downstream.
 */

export type PdfPage = { page: number; lines: string[] };

export type PdfText = {
  pages: PdfPage[];
  /** False when the text layer decodes to symbols and nothing can be trusted. */
  usable: boolean;
  /** First page of the insurer's filed wording, or null where none is attached. */
  wordingStartsAt: number | null;
};

/** A gap wider than this is a column break rather than a space. */
const COLUMN_GAP = 12;

/**
 * Puts a dropped ligature back.
 *
 * Which ligature it was is decided by the letters either side, not by the glyph
 * width — width tells them apart cleanly (fi ≈ 5.3, ff ≈ 6.1, ffi ≈ 9.7 at one
 * size) but scales with the font, and these documents mix sizes freely.
 *
 * English does the work instead: "o?ce" is only ever "office", "o?" at a word
 * end is "off", "e?ect" is "effect", and the overwhelming majority of the rest
 * are fi — benefit, specified, definition, beneficiary, notified, certificate.
 */
export function repairLigatures(line: string): string {
  if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(line)) return line;

  const LIG = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g;

  return line.replace(LIG, (_match, offset: number) => {
    const before = line.slice(Math.max(0, offset - 2), offset);
    const after = line.slice(offset + 1, offset + 4);

    if (/[oO]$/.test(before) && /^ce/i.test(after)) return 'ffi';
    if (/[oO]$/.test(before) && !/^[a-z]/i.test(after)) return 'ff';
    if (/e$/.test(before) && /^ect/i.test(after)) return 'ff';
    if (/su$/i.test(before) && /^er/i.test(after)) return 'ff';
    return 'fi';
  });
}

type TextItem = { str: string; transform: number[]; width?: number };

/**
 * The filed wording begins at a HEADING, never at a mention of one.
 *
 * "Scan to Download Policy Wordings." sits in a TATA AIG page-one footer, and
 * matching that cut a twenty-one page document to nothing — with the entire
 * benefit schedule on the pages that were dropped.
 */
const WORDING_HEADING =
  /^(policy wordings?|standard definitions|specific definitions|standard terms and conditions|general terms and clauses|disclaimer)\s*:?$/i;

export function linesFromItems(items: TextItem[]): string[] {
  const rows = new Map<number, TextItem[]>();

  for (const item of items) {
    const y = Math.round(item.transform[5] ?? 0);
    rows.set(y, [...(rows.get(y) ?? []), item]);
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => {
      const sorted = [...row].sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));
      let line = '';
      let prevEnd: number | null = null;

      for (const item of sorted) {
        const x = item.transform[4] ?? 0;
        if (prevEnd !== null && x - prevEnd > COLUMN_GAP) line += '\t';
        line += item.str;
        prevEnd = x + (item.width ?? 0);
      }

      return repairLigatures(line)
        .replace(/[ \t]+$/g, '')
        .replace(/ {2,}/g, ' ');
    })
    .filter((line) => line.trim().length > 0);
}

/**
 * Letters as a share of characters. Symbols mean the encoding is unusable.
 *
 * Must be given the RAW text, before ligature repair. Repair substitutes
 * letters for control characters, and a document whose every glyph decodes to
 * a control character would be repaired into something that looks like prose —
 * which is precisely the document this exists to reject.
 */
export function textLayerIsUsable(raw: string): boolean {
  const body = raw.slice(0, 20000);
  if (body.length < 200) return false;

  const letters = (body.match(/[a-zA-Z]/g) ?? []).length;
  return letters / body.length > 0.5;
}

/**
 * A boundary has to have something substantial behind it.
 *
 * "Disclaimer" is a real heading for TATA AIG's filed block, which runs from
 * page 8 to page 21 — and it is also a two-line paragraph on page 3 of a
 * four-page Bajaj policy, where matching it threw away the schedule. A section
 * worth trimming is a long one, so a heading with almost nothing after it is
 * not the boundary.
 */
const MIN_WORDING_PAGES = 4;

export function findWordingStart(pages: PdfPage[]): number | null {
  const last = pages[pages.length - 1]?.page ?? 0;

  for (const { page, lines } of pages) {
    // Never page one: a schedule always precedes the wording, and a page-one
    // match is a footer rather than a heading.
    if (page < 2) continue;
    if (last - page < MIN_WORDING_PAGES) continue;

    for (const raw of lines) {
      const line = raw.replace(/\t/g, ' ').trim();
      if (line.length > 60) continue;
      if (WORDING_HEADING.test(line)) return page;
    }
  }
  return null;
}

/**
 * The deal-specific part: the schedule, the benefit tables and any
 * endorsements, without the insurer's filed wording.
 *
 * Bajaj attaches no wording at all — their policies are three to five pages —
 * so "no boundary" means the whole document rather than nothing.
 */
export function bespokePages(text: PdfText): PdfPage[] {
  if (text.wordingStartsAt === null) return text.pages;
  return text.pages.filter((p) => p.page < text.wordingStartsAt!);
}

export async function readPdfText(data: ArrayBuffer): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  /*
   * Hand pdfjs its worker as a module rather than as a path.
   *
   * With no worker configured, pdfjs falls back to importing one by string —
   * `GlobalWorkerOptions.workerSrc`, defaulting to "./pdf.worker.mjs" — and on
   * Vercel that failed outright: "Cannot find module '/var/task/node_modules/
   * pdfjs-dist/legacy/build/pdf.worker.mjs'". The file was not in the
   * deployment, because nothing imports it: it is resolved by string at
   * runtime, and a file tracer cannot follow a path it never reads.
   *
   * Setting `workerSrc` would only move the problem to shipping the file.
   * Instead the worker is imported as a real module specifier — which the
   * tracer does follow — and put on `globalThis.pdfjsWorker`, which pdfjs
   * checks before it resolves anything (see `#mainThreadWorkerMessageHandler`).
   * Nothing is looked up by path, so there is nothing to fail to find.
   */
  const globals = globalThis as { pdfjsWorker?: unknown };
  globals.pdfjsWorker ??=
    // pdfjs ships the worker as an untyped build artefact. Imported by its real
    // specifier rather than by a path string, so the bundler traces and ships
    // it; an ambient `declare module` cannot help here because the subpath does
    // resolve to a file, and resolution wins over a declaration.
    // @ts-expect-error - no types published for the worker build
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: true,
    // Fonts are fetched by path too, and none of this needs to render a glyph.
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise;
  const pages: PdfPage[] = [];
  let raw = '';

  for (let page = 1; page <= doc.numPages; page += 1) {
    const items = (await (await doc.getPage(page)).getTextContent()).items as TextItem[];
    if (raw.length < 20000) raw += items.map((i) => i.str).join('');
    pages.push({ page, lines: linesFromItems(items) });
  }

  return {
    pages,
    usable: textLayerIsUsable(raw),
    wordingStartsAt: findWordingStart(pages),
  };
}
