'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredFile } from '@/lib/cases/read-document';
import { readPdfText } from '@/lib/parsing/pdf-text';
import {
  extractPolicyTerms,
  extractionConfigured,
  type CatalogueEntry,
  type ExtractedTerm,
} from '@/lib/extraction/policy';

export type ExtractionSummary =
  | {
      ok: true;
      proposed: number;
      notStated: number;
      /** Terms a person already reviewed where the policy says something else. */
      disagreements: { benefit: string; reviewed: string | null; read: string }[];
    }
  | { ok: false; message: string }
  | null;

/**
 * The case's expiring-policy row, created on first use.
 *
 * An upsert rather than read-then-insert. Every cell on the terms grid saves
 * independently, so on a case with no policy row yet two quick edits both found
 * nothing and both inserted — `policies.case_id` is unique, so the second lost
 * its constraint race and the edit was dropped with it. Which is the first
 * thing that happens on every new deal.
 */
async function policyIdFor(dealId: string): Promise<string | null> {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from('policies')
    .upsert({ case_id: dealId }, { onConflict: 'case_id' })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    // Lost the race anyway, or cannot write: read whatever is there now.
    const { data: existing } = await supabase
      .from('policies')
      .select('id')
      .eq('case_id', dealId)
      .maybeSingle<{ id: string }>();

    return existing?.id ?? null;
  }

  return data.id;
}

/**
 * Reads the uploaded policy copy and proposes the expiring terms.
 *
 * Three things this deliberately does not do:
 *
 *  - It does not overwrite a term a person has already confirmed or corrected.
 *    A review is a decision; a later run disagreeing with it is information, not
 *    grounds to undo it. Those disagreements come back in the result so the
 *    reviewer can look again, and the run keeps its own reading either way.
 *  - It does not mark anything reviewed. Everything lands as proposed, which
 *    0032's trigger enforces regardless of what this code asks for.
 *  - It does not fail the step. A run that cannot happen leaves the grid exactly
 *    as it was, to be filled in by hand.
 */
export async function readPolicyCopy(
  dealId: string,
  _prev: ExtractionSummary,
): Promise<ExtractionSummary> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  if (!extractionConfigured()) {
    return {
      ok: false,
      message: 'Policy reading is not switched on in this environment. Enter the terms by hand.',
    };
  }

  const doc = await loadDocument(dealId, 'policy_copy');
  if (!doc) {
    return { ok: false, message: 'No policy copy has been uploaded yet.' };
  }

  const isPdf = doc.content_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name);
  if (!isPdf) {
    return {
      ok: false,
      message: `The reader takes PDFs, and ${doc.file_name} is not one. Upload the policy copy as a PDF.`,
    };
  }

  const supabase = supabaseServer();

  const { data: catalogue } = await supabase
    .from('benefit_catalogue')
    .select('benefit_key, section, benefit_label')
    .order('display_order')
    .returns<CatalogueEntry[]>();

  const file = await readStoredFile(doc);
  if (!file.ok) return { ok: false, message: file.message };

  const policyId = await policyIdFor(dealId);
  if (!policyId) {
    return { ok: false, message: 'The expiring policy record could not be created.' };
  }

  // The run is recorded before it starts, so a run that dies leaves a trace
  // rather than nothing — 'running' rows that never completed are the signal
  // that the reader is failing on a particular document.
  const { data: run } = await supabase
    .from('policy_extractions')
    .insert({
      case_id: dealId,
      case_document_id: doc.id,
      status: 'running',
    })
    .select('id')
    .single<{ id: string }>();

  if (!run) {
    return { ok: false, message: 'The extraction could not be recorded, so it was not started.' };
  }

  /*
   * The text layer is read here rather than inside the extractor, so the
   * filed wording can be trimmed before anything leaves the environment and
   * the page markers survive into the evidence.
   */
  let text;
  try {
    text = await readPdfText(file.bytes);
  } catch (error) {
    await supabase
      .from('policy_extractions')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', run.id);

    return {
      ok: false,
      message: `That PDF could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const outcome = await extractPolicyTerms(text, catalogue ?? []);

  if (!outcome.ok) {
    await supabase
      .from('policy_extractions')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', run.id);

    return { ok: false, message: outcome.message };
  }

  // What the reader said, all of it, before anything is filtered by what is
  // already on the grid. This is the record the run is measured against later.
  const extractedTerms: Record<string, unknown> = {};
  const confidenceScores: Record<string, number> = {};
  for (const term of outcome.terms) {
    extractedTerms[term.benefitKey] = {
      value: term.value,
      evidence: term.evidence,
      page: term.page,
    };
    confidenceScores[term.benefitKey] = term.confidence;
  }

  await supabase
    .from('policy_extractions')
    .update({
      status: 'succeeded',
      model_version: outcome.model,
      extracted_terms: extractedTerms,
      confidence_scores: confidenceScores,
      completed_at: new Date().toISOString(),
    })
    .eq('id', run.id);

  const { data: existing } = await supabase
    .from('policy_terms')
    .select('benefit_key, value, review_status')
    .eq('policy_id', policyId)
    .returns<{ benefit_key: string; value: string | null; review_status: string }[]>();

  const reviewed = new Map(
    (existing ?? [])
      .filter((t) => t.review_status !== 'proposed')
      .map((t) => [t.benefit_key, t.value]),
  );

  // Labelled, not keyed: `room_rent_limit_normal_room` is how the schema refers
  // to a benefit and "Room rent — Normal room" is how a person does.
  const labels = new Map((catalogue ?? []).map((c) => [c.benefit_key, c.benefit_label]));
  const disagreements: { benefit: string; reviewed: string | null; read: string }[] = [];
  const writable: ExtractedTerm[] = [];

  for (const term of outcome.terms) {
    if (reviewed.has(term.benefitKey)) {
      const already = reviewed.get(term.benefitKey) ?? null;
      if (term.value && term.value !== already) {
        disagreements.push({
          benefit: labels.get(term.benefitKey) ?? term.benefitKey,
          reviewed: already,
          read: term.value,
        });
      }
      continue;
    }
    writable.push(term);
  }

  const rows = writable.map((term) => ({
    case_id: dealId,
    policy_id: policyId,
    benefit_key: term.benefitKey,
    value: term.value,
    source: 'extracted' as const,
    review_status: 'proposed' as const,
    extraction_confidence: term.confidence,
    evidence_quote: term.evidence,
    evidence_page: term.page,
    extraction_id: run.id,
    updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error } = await supabase
      .from('policy_terms')
      .upsert(rows, { onConflict: 'policy_id,benefit_key' });

    if (error) {
      return { ok: false, message: `The terms could not be saved: ${error.message}` };
    }
  }

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'policy_extracted',
    actor_type: 'user',
    actor_id: session.userId,
    payload: {
      extraction_id: run.id,
      model: outcome.model,
      proposed: rows.filter((r) => r.value !== null).length,
      disagreements: disagreements.length,
    },
  });

  await supabase.from('audit_log').insert({
    entity_type: 'policy_extractions',
    entity_id: run.id,
    action: 'create',
    actor_type: 'user',
    actor_id: session.userId,
    after: { case_id: dealId, document: doc.file_name, terms: rows.length },
  });

  revalidatePath(`/deals/${dealId}/terms`);

  return {
    ok: true,
    proposed: rows.filter((r) => r.value !== null).length,
    notStated: outcome.terms.filter((t) => t.value === null).length,
    disagreements,
  };
}

export type TermSaveResult = { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Records a person's decision about one expiring term.
 *
 * This is the path that has to work when there is no model, no key, and no
 * readable policy copy — the RM knows the terms and wants to build option sets
 * now, with the document attached later at dispatch (ADR 0012, and the gate in
 * `rfq_blockers`). It is also the path every extracted term ends on, because
 * an extraction only ever proposes.
 *
 * Three shapes, and the difference between them is kept rather than flattened:
 *
 *  - Typed where nothing was proposed → `manual`, `confirmed`. A person is the
 *    source and the review at once.
 *  - A proposal agreed with unchanged → stays `extracted`, becomes `confirmed`,
 *    and keeps its clause: the quote still supports the value.
 *  - A proposal changed → becomes `manual` and `corrected`, the clause is
 *    dropped, and the before/after is appended to `policy_extraction_edits`.
 *    The clause has to go: it was evidence for the value the model read, and
 *    leaving it beside a different value would make the policy appear to say
 *    something it does not. The run is still named by `extraction_id`, so the
 *    correction stays traceable to what proposed it.
 */
export async function saveTerm(
  dealId: string,
  benefitKey: string,
  raw: string | null,
): Promise<TermSaveResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const value = raw === null ? null : raw.trim() || null;

  const supabase = supabaseServer();

  const policyId = await policyIdFor(dealId);
  if (!policyId) {
    return { ok: false, message: 'The expiring policy record could not be created.' };
  }

  const { data: existing } = await supabase
    .from('policy_terms')
    .select('id, value, source, evidence_quote, evidence_page, extraction_id')
    .eq('policy_id', policyId)
    .eq('benefit_key', benefitKey)
    .maybeSingle<{
      id: string;
      value: string | null;
      source: string;
      evidence_quote: string | null;
      evidence_page: number | null;
      extraction_id: string | null;
    }>();

  const proposed = existing?.source === 'extracted';
  const unchanged = existing ? (existing.value ?? null) === value : false;
  const now = new Date().toISOString();

  const row = {
    case_id: dealId,
    policy_id: policyId,
    benefit_key: benefitKey,
    value,
    source: proposed && unchanged ? ('extracted' as const) : ('manual' as const),
    // 'corrected' only where there was something to correct. A value typed
    // where nothing was proposed is confirmed by the act of typing it, and
    // counting those as corrections would make the reader look worse than it is.
    review_status:
      proposed && unchanged
        ? ('confirmed' as const)
        : proposed
          ? ('corrected' as const)
          : ('confirmed' as const),
    reviewed_by: session.userId,
    reviewed_at: now,
    evidence_quote: proposed && unchanged ? existing?.evidence_quote : null,
    evidence_page: proposed && unchanged ? existing?.evidence_page : null,
    extraction_id: existing?.extraction_id ?? null,
    updated_at: now,
  };

  const { error } = await supabase
    .from('policy_terms')
    .upsert(row, { onConflict: 'policy_id,benefit_key' });

  if (error) return { ok: false, message: error.message };

  // The eval signal (§8): what the model said, what a person made it, per
  // field, over time. Appended only where there was something to correct.
  if (proposed && !unchanged && existing?.extraction_id) {
    await supabase.from('policy_extraction_edits').insert({
      case_id: dealId,
      extraction_id: existing.extraction_id,
      benefit_key: benefitKey,
      original_value: existing.value,
      corrected_value: value,
      corrected_by: session.userId,
    });
  }

  await supabase.from('audit_log').insert({
    entity_type: 'policy_terms',
    entity_id: policyId,
    action: existing ? 'update' : 'create',
    actor_type: 'user',
    actor_id: session.userId,
    before: existing ? { benefit_key: benefitKey, value: existing.value } : null,
    after: { benefit_key: benefitKey, value, review_status: row.review_status },
  });

  revalidatePath(`/deals/${dealId}/terms`);

  return { ok: true, value };
}
