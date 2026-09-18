'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredSheet } from '@/lib/cases/read-document';
import { CLAIM_FIELDS, matchColumns, overrideMapping } from '@/lib/parsing/columns';
import {
  computeClaims,
  findDiscrepancies,
  readClaims,
  readMis,
  type ClaimsResult,
  type Discrepancy,
  type StatedFigure,
} from '@/lib/parsing/claims';

export type ClaimsPreview =
  | {
      ok: true;
      result: ClaimsResult;
      headers: string[];
      fileName: string;
      stated: StatedFigure[];
      misFileName: string | null;
      discrepancies: Discrepancy[];
      premium: number | null;
    }
  | { ok: false; message: string };

/** The premium the ratio is computed against, from the expiring policy. */
async function expiringPremium(dealId: string): Promise<number | null> {
  const supabase = supabaseServer();
  const { data } = await supabase
    .from('policies')
    .select('expiring_premium')
    .eq('case_id', dealId)
    .maybeSingle<{ expiring_premium: number | null }>();

  return data?.expiring_premium ?? null;
}

/**
 * Reads the dump and the MIS, and reports where they disagree.
 *
 * Both are read here and neither is reconciled: the discrepancies are returned
 * for a person to settle (ADR 0011 rule 5). Nothing is written.
 */
export async function previewClaims(
  dealId: string,
  overrides: Record<string, string | null> = {},
): Promise<ClaimsPreview> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const dump = await loadDocument(dealId, 'claims_dump');
  if (!dump) return { ok: false, message: 'No claims dump has been uploaded yet.' };

  const sheet = await readStoredSheet(dump);
  if (!sheet.ok) return { ok: false, message: sheet.message };

  const base = matchColumns(sheet.sheet.headers, CLAIM_FIELDS);
  const mapping = Object.keys(overrides).length > 0 ? overrideMapping(base, overrides) : base;
  const result = readClaims(sheet.sheet, mapping);

  // The premium is not in a claims dump, so the ratio is recomputed with it
  // once we have one — otherwise the dump can report every figure except the
  // one people actually argue about.
  const premium = await expiringPremium(dealId);
  const computed = computeClaims(result.claims, premium);

  const mis = await loadDocument(dealId, 'claims_mis');
  let stated: StatedFigure[] = [];

  if (mis) {
    const misSheet = await readStoredSheet(mis);
    if (misSheet.ok) stated = readMis(misSheet.sheet).figures;
  }

  return {
    ok: true,
    result: { ...result, computed },
    headers: sheet.sheet.headers,
    fileName: dump.file_name,
    stated,
    misFileName: mis?.file_name ?? null,
    discrepancies: findDiscrepancies(stated, computed),
    premium,
  };
}

export type LoadClaimsResult = { ok: true; loaded: number } | { ok: false; message: string } | null;

/**
 * Commits the dump, the stated figures, and any disagreement between them.
 *
 * The discrepancies are written unresolved on purpose: an undecided row holds
 * the RFQ, and that is what makes the choice unavoidable rather than optional.
 */
export async function loadClaims(
  dealId: string,
  _prev: LoadClaimsResult,
  formData: FormData,
): Promise<LoadClaimsResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const overrides = JSON.parse(String(formData.get('overrides') ?? '{}')) as Record<
    string,
    string | null
  >;

  const preview = await previewClaims(dealId, overrides);
  if (!preview.ok) return { ok: false, message: preview.message };

  const supabase = supabaseServer();
  const dump = await loadDocument(dealId, 'claims_dump');

  const { data: upload } = await supabase
    .from('claims_uploads')
    .insert({
      case_id: dealId,
      file_ref: dump?.file_ref ?? 'unknown',
      detected_format: { mapping: preview.result.mapping.matches },
      uploaded_by: session.userId,
    })
    .select('id')
    .single<{ id: string }>();

  // Replace, for the same reason the roster does: a dump states the history,
  // it is not a log of every file ever sent.
  await supabase.from('claim_records').delete().eq('case_id', dealId);

  const rows = preview.result.claims.map((c) => ({
    case_id: dealId,
    claims_upload_id: upload?.id ?? null,
    claim_ref: c.claimRef,
    member_ref: c.memberRef,
    relationship: c.relationship,
    claim_type: c.claimType,
    status: c.status,
    incurred_on: c.incurredOn,
    reported_on: c.reportedOn,
    claimed_amount: c.claimedAmount,
    paid_amount: c.paidAmount,
    diagnosis: c.diagnosis,
    source_row: c.sourceRow,
    row_number: c.rowNumber,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('claim_records').insert(rows.slice(i, i + 500));
    if (error) return { ok: false, message: error.message };
  }

  if (preview.stated.length > 0) {
    const misDoc = await loadDocument(dealId, 'claims_mis');
    await supabase.from('claims_stated_figures').delete().eq('case_id', dealId);
    await supabase.from('claims_stated_figures').insert(
      preview.stated.map((f) => ({
        case_id: dealId,
        document_id: misDoc?.id ?? null,
        metric: f.metric,
        value: f.value,
        source_label: f.sourceLabel,
      })),
    );
  }

  // Undecided, deliberately. A resolved row from a previous load is dropped
  // along with the rest: the figures behind the decision have just changed, so
  // the decision has to be made again against the new ones.
  await supabase.from('claims_reconciliations').delete().eq('case_id', dealId);
  if (preview.discrepancies.length > 0) {
    await supabase.from('claims_reconciliations').insert(
      preview.discrepancies.map((d) => ({
        case_id: dealId,
        metric: d.metric,
        stated_value: d.stated,
        computed_value: d.computed,
      })),
    );
  }

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'claims_loaded',
    actor_type: 'user',
    actor_id: session.userId,
    payload: {
      claims: rows.length,
      stated_figures: preview.stated.length,
      discrepancies: preview.discrepancies.length,
      file: preview.fileName,
    },
  });

  revalidatePath(`/deals/${dealId}/claims`);
  return { ok: true, loaded: rows.length };
}

export type ResolveResult = { ok: true } | { ok: false; message: string } | null;

/** Records which figure goes forward, and who decided. */
export async function resolveDiscrepancy(
  dealId: string,
  metric: string,
  _prev: ResolveResult,
  formData: FormData,
): Promise<ResolveResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const chosen = String(formData.get('chosen') ?? '');
  if (!['stated', 'computed', 'neither'].includes(chosen)) {
    return { ok: false, message: 'Choose which figure goes into the RFQ.' };
  }

  const note = String(formData.get('note') ?? '').trim() || null;
  const supabase = supabaseServer();

  const { data: row } = await supabase
    .from('claims_reconciliations')
    .select('stated_value, computed_value')
    .eq('case_id', dealId)
    .eq('metric', metric)
    .maybeSingle<{ stated_value: number; computed_value: number }>();

  if (!row) return { ok: false, message: 'That discrepancy is no longer on this deal.' };

  let value: number | null;
  if (chosen === 'stated') value = row.stated_value;
  else if (chosen === 'computed') value = row.computed_value;
  else {
    const typed = Number(String(formData.get('own_value') ?? '').replace(/[, ]/g, ''));
    if (!Number.isFinite(typed)) {
      return { ok: false, message: 'Give the figure you are quoting on.' };
    }
    if (!note) return { ok: false, message: 'Say why neither figure is right.' };
    value = typed;
  }

  const { error } = await supabase
    .from('claims_reconciliations')
    .update({
      chosen,
      chosen_value: value,
      note,
      decided_by: session.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('case_id', dealId)
    .eq('metric', metric);

  if (error) return { ok: false, message: error.message };

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'claims_discrepancy_resolved',
    actor_type: 'user',
    actor_id: session.userId,
    // The evidence, not the outcome: both figures, the choice and the reason,
    // so the decision can be explained or disputed later (§9, §11).
    payload: {
      metric,
      chosen,
      value,
      stated: row.stated_value,
      computed: row.computed_value,
      note,
    },
  });

  revalidatePath(`/deals/${dealId}/claims`);
  return { ok: true };
}
