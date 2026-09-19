'use server';

import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredFile } from '@/lib/cases/read-document';
import { readPdfText } from '@/lib/parsing/pdf-text';
import { readPolicyFacts, type PolicyFacts } from '@/lib/parsing/policy-facts';

export type SuggestedFact = { value: string; evidence: string; page: number };

export type FactsResult =
  | { ok: true; facts: Partial<Record<keyof PolicyFacts, SuggestedFact>>; pagesRead: number }
  | { ok: false; message: string }
  | null;

/**
 * Reads the deal-setup facts off the uploaded policy copy.
 *
 * No model and no API key: these are labelled values on a schedule, and rules
 * read them for nothing. Measured across fifteen real policies from three
 * insurers, the schedule-issuing ones give up every field — insurer, TPA,
 * broker, policy number, policyholder, GSTIN, period, sum insured, premium and
 * lives — and the only failures are documents that do not state the fact at
 * all, plus one whose text layer decodes to symbols.
 *
 * Nothing is written. The result is offered on the form, where a person accepts
 * it or does not: a policy schedule can carry an address three renewals old,
 * and the GSTN register beats it wherever they disagree (ADR 0011 rule 4).
 */
export async function readPolicyFactsFor(dealId: string, _prev: FactsResult): Promise<FactsResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const doc = await loadDocument(dealId, 'policy_copy');
  if (!doc) return { ok: false, message: 'No policy copy has been uploaded yet.' };

  if (!(doc.content_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name))) {
    return { ok: false, message: `${doc.file_name} is not a PDF, so there is no text to read.` };
  }

  const file = await readStoredFile(doc);
  if (!file.ok) return { ok: false, message: file.message };

  let text;
  try {
    text = await readPdfText(file.bytes);
  } catch (error) {
    return {
      ok: false,
      message: `That PDF could not be opened: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const outcome = readPolicyFacts(text);
  if (!outcome.ok) return { ok: false, message: outcome.message };

  const facts: Partial<Record<keyof PolicyFacts, SuggestedFact>> = {};
  for (const [key, fact] of Object.entries(outcome.facts)) {
    if (!fact) continue;
    facts[key as keyof PolicyFacts] = {
      value: String(fact.value),
      evidence: fact.evidence,
      page: fact.page,
    };
  }

  return { ok: true, facts, pagesRead: outcome.pagesRead };
}
