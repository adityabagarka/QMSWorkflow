'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredFile } from '@/lib/cases/read-document';
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

/** The case's expiring-policy row, created on first use. */
async function policyIdFor(dealId: string): Promise<string | null> {
  const supabase = supabaseServer();

  const { data: existing } = await supabase
    .from('policies')
    .select('id')
    .eq('case_id', dealId)
    .maybeSingle<{ id: string }>();

  if (existing) return existing.id;

  const { data } = await supabase
    .from('policies')
    .insert({ case_id: dealId })
    .select('id')
    .single<{ id: string }>();

  return data?.id ?? null;
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

  const outcome = await extractPolicyTerms(file.bytes, catalogue ?? []);

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
