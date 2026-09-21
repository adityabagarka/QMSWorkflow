'use server';

import { attempt } from '@/lib/actions/attempt';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredSheet } from '@/lib/cases/read-document';
import { matchColumns, MEMBER_FIELDS, overrideMapping } from '@/lib/parsing/columns';
import { readRoster, summariseRoster, type RosterResult } from '@/lib/parsing/roster';
import { findDeviations, type GoverningTerms } from '@/lib/members/deviations';
import type { Relationship } from '@/lib/parsing/values';

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
  return attempt('Reading the member file', async () => {
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
  });
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
  return attempt('Loading the roster', async () => {
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

    /*
     * Replace, not add.
     *
     * This was a plain DELETE issued as the signed-in user, and DELETE on
     * member_records is Super Admin only (0008). Under RLS that removed nothing
     * and reported success, so a corrected roster was ADDED to the old one —
     * two uploads of the same fifteen people made a thirty-life deal, and the
     * burn, the demography and the RFQ were all built on it. Migration 0045
     * makes clearing one case's roster a named operation that checks the case
     * can be written, and this checks that it worked.
     */
    const { error: cleared } = await supabase.rpc('clear_member_records', { p_case_id: dealId });
    if (cleared) return { ok: false, message: cleared.message };

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
  });
}

export type DeviationResult =
  { ok: true; found: number; termsRead: number } | { ok: false; message: string } | null;

/**
 * Runs the deviation check against the expiring policy's terms.
 *
 * Separate from loading the roster because the terms may be confirmed after
 * the roster arrives, or corrected afterwards — so this is re-runnable, and
 * re-running replaces rather than accumulates.
 */
export async function detectDeviations(dealId: string): Promise<DeviationResult> {
  return attempt('The deviation check', async () => {
    const session = await getSession();
    if (!session || session.status !== 'active') {
      return { ok: false, message: 'Your access is not active.' };
    }

    const supabase = supabaseServer();

    const { data: policy } = await supabase
      .from('policies')
      .select('id')
      .eq('case_id', dealId)
      .maybeSingle<{ id: string }>();

    if (!policy) {
      return {
        ok: false,
        message:
          'There is nothing to check against yet: the expiring policy has not been set up on step 1.',
      };
    }

    const [{ data: terms }, { data: members }] = await Promise.all([
      supabase
        .from('policy_terms')
        .select('benefit_key, value')
        .eq('policy_id', policy.id)
        .returns<{ benefit_key: string; value: string | null }[]>(),
      supabase
        .from('member_records')
        .select('id, relationship, age, name_clean, employee_id')
        .eq('case_id', dealId)
        .returns<
          {
            id: string;
            relationship: string | null;
            age: number | null;
            name_clean: string | null;
            employee_id: string | null;
          }[]
        >(),
    ]);

    const governing: GoverningTerms = {};
    for (const t of terms ?? []) governing[t.benefit_key] = t.value;

    /*
     * Nothing to compare against is not the same as nothing to report, and the
     * two used to look identical. A deal whose terms have not been confirmed
     * yields no deviations for the plain reason that no term says what is
     * allowed — saying so is more use than an empty result.
     */
    if (Object.keys(governing).length === 0) {
      return {
        ok: false,
        message:
          'The expiring policy has no terms confirmed yet, so there is nothing to measure the roster against. Confirm them on step 4 and check again.',
      };
    }

    if ((members ?? []).length === 0) {
      return { ok: false, message: 'There is no roster loaded to check.' };
    }

    const found = findDeviations(
      (members ?? []).map((m) => ({
        id: m.id,
        relationship: m.relationship as Relationship | null,
        age: m.age,
        name: m.name_clean,
        employeeId: m.employee_id,
      })),
      governing,
      'expiring_policy',
    );

    // Replace this source's rows only. Deviations found against the RFQ's own
    // terms are a separate pass and must survive a re-run of this one.
    //
    // Through 0045's function rather than a DELETE: the DELETE was Super Admin
    // only, so for everybody else it removed nothing and the re-run then
    // collided with member_deviations_expiring_idx — which is why this button
    // worked once and never again.
    const { error: cleared } = await supabase.rpc('clear_member_deviations', {
      p_case_id: dealId,
      p_source: 'expiring_policy',
      p_option_id: null,
    });
    if (cleared) return { ok: false, message: cleared.message };

    if (found.length > 0) {
      const { error } = await supabase.from('member_deviations').insert(
        found.map((d) => ({
          case_id: dealId,
          member_record_id: d.memberId,
          benefit_key: d.benefitKey,
          source: 'expiring_policy',
          expected_value: d.expectedValue,
          actual_value: d.actualValue,
          detail: d.detail,
          is_continuation: d.isContinuation,
        })),
      );
      if (error) return { ok: false, message: error.message };
    }

    await supabase.from('case_events').insert({
      case_id: dealId,
      event_type: 'member_deviations_detected',
      actor_type: 'user',
      actor_id: session.userId,
      payload: { found: found.length, continuations: found.filter((d) => d.isContinuation).length },
    });

    revalidatePath(`/deals/${dealId}/members`);
    return { ok: true, found: found.length, termsRead: Object.keys(governing).length };
  });
}
