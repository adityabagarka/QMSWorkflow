'use server';

import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { loadDocument, readStoredFile } from '@/lib/cases/read-document';
import { readPdfText } from '@/lib/parsing/pdf-text';
import { readPolicyFacts } from '@/lib/parsing/policy-facts';
import {
  CUSTOMER_FIELDS,
  POLICY_FIELDS,
  firstWriteError,
  planPolicyFill,
  type ReadValue,
} from './policy-fill-plan';

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
    .select('customer_id, policy_expiry_date, customers(legal_name, gstin, location)')
    .eq('id', dealId)
    .maybeSingle<{
      customer_id: string;
      policy_expiry_date: string | null;
      customers: { legal_name: string; gstin: string | null; location: string | null } | null;
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

  const values: Record<string, ReadValue> = {};
  for (const [key, fact] of Object.entries(outcome.facts)) {
    if (!fact) continue;
    if (!(key in CUSTOMER_FIELDS) && !(key in POLICY_FIELDS) && key !== 'policyEnd') {
      continue;
    }
    values[key] = { value: await resolved(key, String(fact.value)), page: fact.page };
  }

  const plan = planPolicyFill(values, {
    legal_name: deal.customers?.legal_name ?? null,
    gstin: deal.customers?.gstin ?? null,
    location: deal.customers?.location ?? null,
    insurer_name: policy?.insurer_name ?? null,
    broker_name: policy?.broker_name ?? null,
    tpa_name: policy?.tpa_name ?? null,
    expiring_premium: policy?.expiring_premium ?? null,
    policy_expiry_date: deal.policy_expiry_date,
  });

  const { customerPatch, policyPatch, expiry, filled } = plan;
  const readings = plan.readings.map((reading) => ({
    case_id: dealId,
    case_document_id: doc.id,
    ...reading,
  }));

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

  /*
   * The writes have to succeed before the read is recorded.
   *
   * These three used to be fired and forgotten. When the `policies` update
   * failed — a column the staging database had not been migrated to yet — the
   * customer patch still landed, the readings were still written and the
   * activity still said "policy read", while insurer, broker, TPA and premium
   * stayed empty on the deal. Worse, the readings are what stops this running
   * twice, so the failure was permanent: every later load saw the marker and
   * returned early. A failed write now leaves nothing behind, so the next load
   * tries again, and the reason reaches the server log instead of nowhere.
   */
  const writes: [string, { error: { message: string } | null }][] = [];

  if (Object.keys(customerPatch).length > 0) {
    writes.push([
      'customers',
      await supabase.from('customers').update(customerPatch).eq('id', deal.customer_id),
    ]);
  }
  if (Object.keys(policyPatch).length > 0) {
    writes.push([
      'policies',
      await supabase.from('policies').update(policyPatch).eq('case_id', dealId),
    ]);
  }
  if (expiry) {
    writes.push([
      'cases',
      await supabase.from('cases').update({ policy_expiry_date: expiry }).eq('id', dealId),
    ]);
  }

  const failure = firstWriteError(writes);
  if (failure) {
    console.error(`applyPolicyFacts: ${failure.table} write failed`, failure.message);
    return null;
  }

  if (readings.length > 0) {
    const { error } = await supabase
      .from('policy_fact_reads')
      .upsert(readings, { onConflict: 'case_id,field' });

    if (error) {
      console.error('applyPolicyFacts: policy_fact_reads write failed', error.message);
      return null;
    }
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
