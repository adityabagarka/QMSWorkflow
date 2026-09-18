import { supabaseServer } from '@/lib/db/server';
import { largestSheet, parseCsv, parseWorkbook, type Sheet } from '@/lib/parsing/sheet';
import type { DocumentKind } from '@/lib/cases/documents';

const BUCKET = 'case-documents';

export type StoredDocument = {
  id: string;
  kind: DocumentKind;
  file_name: string;
  file_ref: string;
  content_type: string | null;
};

/**
 * Fetches a stored document and turns it into a sheet.
 *
 * The format is decided by what the file actually is rather than by its
 * extension: people rename files, and a .xls that is really a CSV is common
 * enough from insurer portals that trusting the name fails regularly. The
 * workbook reader is tried first and a failure falls through to CSV, because a
 * real workbook is never valid CSV while the reverse mistake is routine.
 */
export async function readStoredSheet(
  doc: StoredDocument,
): Promise<{ ok: true; sheet: Sheet } | { ok: false; message: string }> {
  const supabase = supabaseServer();

  const { data, error } = await supabase.storage.from(BUCKET).download(doc.file_ref);
  if (error || !data) {
    return {
      ok: false,
      message: `The file could not be read back: ${error?.message ?? 'missing'}`,
    };
  }

  const buffer = await data.arrayBuffer();

  const looksLikeText = /\.(csv|txt|tsv)$/i.test(doc.file_name);
  if (!looksLikeText) {
    try {
      const sheets = await parseWorkbook(buffer);
      const sheet = largestSheet(sheets);
      if (sheet && sheet.rows.length > 0) return { ok: true, sheet };
    } catch {
      // Not a workbook after all; CSV below.
    }
  }

  try {
    const text = new TextDecoder('utf-8').decode(buffer);
    const sheet = parseCsv(text, doc.file_name);
    if (sheet.rows.length > 0) return { ok: true, sheet };
    return { ok: false, message: 'There are no rows in that file.' };
  } catch {
    return {
      ok: false,
      message: 'That file is not a spreadsheet this can read. CSV, XLS and XLSX work.',
    };
  }
}

/** The current document of a kind on a case, or null. */
export async function loadDocument(
  caseId: string,
  kind: DocumentKind,
): Promise<StoredDocument | null> {
  const supabase = supabaseServer();
  const { data } = await supabase
    .from('case_documents')
    .select('id, kind, file_name, file_ref, content_type')
    .eq('case_id', caseId)
    .eq('kind', kind)
    .maybeSingle<StoredDocument>();

  return data;
}
