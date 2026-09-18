'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredSheet } from '@/lib/cases/read-document';
import { matchColumns, MEMBER_FIELDS, overrideMapping } from '@/lib/parsing/columns';
import { readRoster, summariseRoster, type RosterResult } from '@/lib/parsing/roster';

export type RosterPreview =
  | { ok: true; result: RosterResult; headers: string[]; fileName: string }
  | { ok: false; message: string };

/**
 * Reads the roster without writing anything.
 *
 * Separate from loading it because the mapping is a guess until somebody looks
 * at it: "Employee Name" and "Emp Code" are told apart by a pattern, and the
 * file that defeats the pattern is the one where a person has to say which
 * column is which. Nothing reaches `member_records` until that has happened.
 */
export async function previewRoster(
  dealId: string,
  overrides: Record<string, string | null> = {},
): Promise<RosterPreview> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const doc = await loadDocument(dealId, 'member_data');
  if (!doc) return { ok: false, message: 'No member data has been uploaded yet.' };

  const sheet = await readStoredSheet(doc);
  if (!sheet.ok) return { ok: false, message: sheet.message };

  const supabase = supabaseServer();
  const { data: deal } = await supabase
    .from('cases')
    .select('cover_start_date')
    .eq('id', dealId)
    .maybeSingle<{ cover_start_date: string | null }>();

  /*
   * Ages are computed at cover start, not today: that is the date the insurer
   * prices on, and a roster read in September for cover starting in November
   * would otherwise put everyone born in October a year too young.
   *
   * With no cover start set yet, today is the honest fallback — and the screen
   * says which was used rather than letting the figure look settled.
   */
  const asOf = deal?.cover_start_date ?? new Date().toISOString().slice(0, 10);

  const base = matchColumns(sheet.sheet.headers, MEMBER_FIELDS);
  const mapping = Object.keys(overrides).length > 0 ? overrideMapping(base, overrides) : base;

  return {
    ok: true,
    result: readRoster(sheet.sheet, asOf, mapping),
    headers: sheet.sheet.headers,
    fileName: doc.file_name,
  };
}

export type LoadResult = { ok: true; loaded: number } | { ok: false; message: string } | null;

/**
 * Commits a read roster to `member_records`.
 *
 * Replaces rather than appends. A roster is a statement of who is covered, not
 * a log of who has ever been mentioned — loading a corrected file on top of an
 * older one would otherwise double every life on it, and every figure computed
 * from them.
 */
export async function loadRoster(
  dealId: string,
  _prev: LoadResult,
  formData: FormData,
): Promise<LoadResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const overrides = JSON.parse(String(formData.get('overrides') ?? '{}')) as Record<
    string,
    string | null
  >;

  const preview = await previewRoster(dealId, overrides);
  if (!preview.ok) return { ok: false, message: preview.message };

  const { result } = preview;
  if (result.members.length === 0) {
    return { ok: false, message: 'Nothing in that file could be read as a member.' };
  }

  const supabase = supabaseServer();

  const doc = await loadDocument(dealId, 'member_data');
  const { data: upload } = await supabase
    .from('member_uploads')
    .insert({
      case_id: dealId,
      file_ref: doc?.file_ref ?? 'unknown',
      detected_format: {
        mapping: result.mapping.matches,
        assumptions: result.assumptions,
        issues: result.issues.length,
      },
      uploaded_by: session.userId,
    })
    .select('id')
    .single<{ id: string }>();

  await supabase.from('member_records').delete().eq('case_id', dealId);

  const rows = result.members.map((m) => ({
    case_id: dealId,
    member_upload_id: upload?.id ?? null,
    relationship: m.relationship,
    gender: m.gender,
    dob: m.dob,
    age: m.age,
    employee_id: m.employeeId,
    name_clean: m.name,
  }));

  // In batches: a roster of several thousand lives in one statement is a
  // request large enough to be refused, and a partial load is worse than none.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('member_records').insert(rows.slice(i, i + 500));
    if (error) return { ok: false, message: error.message };
  }

  const summary = summariseRoster(result.members);

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'member_roster_loaded',
    actor_type: 'user',
    actor_id: session.userId,
    payload: {
      lives: summary.lives,
      by_relationship: summary.byRelationship,
      issues: result.issues.length,
      file: preview.fileName,
    },
  });

  revalidatePath(`/deals/${dealId}/members`);
  return { ok: true, loaded: rows.length };
}
