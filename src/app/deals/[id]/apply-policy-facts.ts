'use server';

import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredFile } from '@/lib/cases/read-document';
import { readPdfText } from '@/lib/parsing/pdf-text';
import { readPolicyFacts } from '@/lib/parsing/policy-facts';

/**
 * Fills the deal from the policy copy, once, as soon as the document is there.
 *
 * Three decisions, all taken deliberately:
 *
 *  - **It writes.** The read values used to live only in the browser, so the
 *    summary said "—" while the form showed values, and nothing was persisted
 *    unless the user happened to touch a field. A value nobody has reviewed
 *    sitting in the database is fine for deal facts, which are visible on the
 *    screen they belong to; it is emphatically not fine for policy terms, where
 *    an unreviewed value can reach an insurer, which is why nothing like this
 *    happens there (ADR 0012).
 *
 *  - **It never overwrites.** Only fields that are empty are filled. A value a
 *    person has entered, or the GSTN register supplied, beats a schedule that
 *    can be three renewals old (ADR 0011 rule 4).
 *
 *  - **It records what it read.** Every reading goes to `policy_fact_reads`
 *    with what the deal ended up holding, so "was this read or typed?" has an
 *    answer later, and so the parser can be measured against what people let
 *    stand (migration 0043).
 */

type Applied = { read: number; filled: number };

/** What the reader calls a fact, against where it lives on the deal. */
const CUSTOMER_FIELDS = {
  policyholderName: 'legal_name',
  gstin: 'gstin',
} as const;

const POLICY_FIELDS = {
  insurerName: 'insurer_name',
  brokerName: 'broker_name',
  tpaName: 'tpa_name',
  premium: 'expiring_premium',
} as const;

/** Which party list a name has to be resolved against before it is offered. */
const PARTY_KIND: Partial<Record<string, 'insurer' | 'tpa' | 'broker'>> = {
  insurerName: 'insurer',
  tpaName: 'tpa',
  brokerName: 'broker',
};

export async function applyPolicyFacts(dealId: string): Promise<Applied | null> {
  const session = await getSession();
  if (!session || session.status !== 'active') return null;

  const doc = await loadDocument(dealId, 'policy_copy');
  if (!doc) return null;
  if (!(doc.content_type === 'application/pdf' || /\.pdf$/i.test(doc.file_name))) return null;

  const supabase = supabaseServer();

  // Read once per document. Re-reading the same file cannot tell us anything
  // new, and this runs on every load of the step.
  const { data: already } = await supabase
    .from('policy_fact_reads')
    .select('field')
    .eq('case_id', dealId)
    .eq('case_document_id', doc.id)
    .limit(1);

  if (already && already.length > 0) return null;

  const file = await readStoredFile(doc);
  if (!file.ok) return null;

  let outcome;
  try {
    outcome = readPolicyFacts(await readPdfText(file.bytes));
  } catch {
    return null;
  }
  if (!outcome.ok) return null;

  const { data: deal } = await supabase
    .from('cases')
    .select('customer_id, policy_expiry_date, customers(legal_name, gstin)')
    .eq('id', dealId)
    .maybeSingle<{
      customer_id: string;
      policy_expiry_date: string | null;
      customers: { legal_name: string; gstin: string | null } | null;
    }>();

  if (!deal) return null;

  const { data: policy } = await supabase
    .from('policies')
    .upsert({ case_id: dealId }, { onConflict: 'case_id' })
    .select('insurer_name, broker_name, tpa_name, expiring_premium')
    .single<{
      insurer_name: string | null;
      broker_name: string | null;
      tpa_name: string | null;
      expiring_premium: number | null;
    }>();

  /** The short name we hold for a party, or what the schedule printed. */
  async function resolved(key: string, value: string): Promise<string> {
    const kind = PARTY_KIND[key];
    if (!kind) return value;
    const { data } = await supabase.rpc('resolve_party_name', { p_kind: kind, p_name: value });
    return (data as string | null) ?? value;
  }

  const customerPatch: Record<string, string> = {};
  const policyPatch: Record<string, string> = {};
  const readings: {
    case_id: string;
    case_document_id: string;
    field: string;
    read_value: string;
    read_page: number;
    saved_value: string | null;
  }[] = [];

  let filled = 0;

  for (const [key, fact] of Object.entries(outcome.facts)) {
    if (!fact) continue;

    const value = await resolved(key, String(fact.value));

    const customerField = CUSTOMER_FIELDS[key as keyof typeof CUSTOMER_FIELDS];
    const policyField = POLICY_FIELDS[key as keyof typeof POLICY_FIELDS];

    let current: string | null = null;
    if (customerField === 'legal_name') current = deal.customers?.legal_name ?? null;
    if (customerField === 'gstin') current = deal.customers?.gstin ?? null;
    if (policyField) {
      const held = policy?.[policyField as keyof typeof policy];
      current = held === null || held === undefined ? null : String(held);
    }
    if (key === 'policyEnd') current = deal.policy_expiry_date;

    const empty = !current || !String(current).trim();

    if (empty) {
      if (customerField) customerPatch[customerField] = value;
      if (policyField) policyPatch[policyField] = value;
      if (key === 'policyEnd') policyPatch.__expiry = value;
      if (customerField || policyField || key === 'policyEnd') filled += 1;
    }

    readings.push({
      case_id: dealId,
      case_document_id: doc.id,
      field: customerField ?? policyField ?? (key === 'policyEnd' ? 'policy_expiry_date' : key),
      read_value: value,
      read_page: fact.page,
      saved_value: empty ? value : (current ?? null),
    });
  }

  const expiry = policyPatch.__expiry;
  delete policyPatch.__expiry;

  /*
   * A legal name that is really a GSTIN is refused everywhere else (0028), and
   * the reader can produce one where a schedule prints the two together.
   */
  if (
    customerPatch.legal_name &&
    /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]{3}$/.test(customerPatch.legal_name)
  ) {
    delete customerPatch.legal_name;
  }

  /*
   * Never write a GSTIN another customer already holds.
   *
   * The parser now refuses an insurer's own number (its markers give it away),
   * but this writes without anybody looking, and `customers.gstin` is unique —
   * so a number that slipped through would fail the second deal with an error
   * nobody could act on. Two customers claiming one taxpayer is a merge
   * somebody has to decide, not something an automatic fill should attempt.
   */
  if (customerPatch.gstin) {
    const { data: taken } = await supabase
      .from('customers')
      .select('id')
      .eq('gstin', customerPatch.gstin)
      .neq('id', deal.customer_id)
      .maybeSingle<{ id: string }>();

    if (taken) delete customerPatch.gstin;
  }

  if (Object.keys(customerPatch).length > 0) {
    await supabase.from('customers').update(customerPatch).eq('id', deal.customer_id);
  }
  if (Object.keys(policyPatch).length > 0) {
    await supabase.from('policies').update(policyPatch).eq('case_id', dealId);
  }
  if (expiry) {
    await supabase.from('cases').update({ policy_expiry_date: expiry }).eq('id', dealId);
  }

  if (readings.length > 0) {
    await supabase.from('policy_fact_reads').upsert(readings, { onConflict: 'case_id,field' });
  }

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'policy_read',
    actor_type: 'system',
    actor_id: null,
    payload: { document: doc.file_name, read: readings.length, filled },
  });

  return { read: readings.length, filled };
}
