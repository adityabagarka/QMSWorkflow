import { supabaseServer } from '@/lib/db/server';

/**
 * The company a deal is for.
 *
 * A customer outlives any one deal: this year's rollover and next year's
 * renewal are two cases against one customer (ADR 0011 rule 4). The company
 * facts live here; the programme being rolled over lives on the case.
 */
export type Customer = {
  id: string;
  gstin: string | null;
  legal_name: string;
  entity_type: string | null;
  industry: string | null;
  location: string | null;
  date_of_incorporation: string | null;
};

export const CUSTOMER_COLUMNS =
  'id, gstin, legal_name, entity_type, industry, location, date_of_incorporation';

/**
 * GSTINs are uppercase alphanumeric, and the database refuses anything else.
 *
 * Normalising on the way in rather than rejecting is deliberate: somebody
 * typing lowercase has not made a mistake worth stopping for, but storing it
 * that way would miss the uniqueness check and create the duplicate customer
 * the GSTIN exists to prevent.
 */
export function normaliseGstin(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** For the picker on a new deal: match on either the name or the GSTIN. */
export async function searchCustomers(query: string, limit = 8): Promise<Customer[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const supabase = supabaseServer();
  const { data } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .or(`legal_name.ilike.%${q}%,gstin.ilike.%${q}%`)
    .order('legal_name')
    .limit(limit)
    .returns<Customer[]>();

  return data ?? [];
}

export async function loadCustomer(id: string): Promise<Customer | null> {
  const supabase = supabaseServer();
  const { data } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .eq('id', id)
    .maybeSingle<Customer>();

  return data;
}

export type CustomerFacts = {
  legal_name: string;
  gstin?: string | null;
  entity_type?: string | null;
  industry?: string | null;
  location?: string | null;
  date_of_incorporation?: string | null;
};

/**
 * Finds the customer this describes, or creates it.
 *
 * Matching is by GSTIN first, because it identifies exactly one taxpayer and
 * two people typing the same company's name rarely type it the same way. Only
 * when there is no GSTIN does it fall back to the name, case-insensitively.
 *
 * Nothing here overwrites a customer that already exists. A second deal against
 * a known company should not quietly rewrite that company's registered details
 * from whatever was typed on this one — correcting them is its own act, on the
 * customer, with an audit entry against it.
 */
export async function findOrCreateCustomer(
  facts: CustomerFacts,
  createdBy: string,
): Promise<{ ok: true; customer: Customer; created: boolean } | { ok: false; message: string }> {
  const supabase = supabaseServer();
  const gstin = normaliseGstin(facts.gstin);
  const legalName = facts.legal_name.trim();

  if (!legalName) {
    return { ok: false, message: 'A legal name is needed — it is what the policy is issued in.' };
  }

  if (gstin) {
    const { data } = await supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('gstin', gstin)
      .maybeSingle<Customer>();

    if (data) return { ok: true, customer: data, created: false };
  } else {
    // Only an exact name match, and only when neither side has a GSTIN. A
    // looser match would merge two genuinely different companies that happen to
    // share a name, which is far harder to undo than a duplicate.
    const { data } = await supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .is('gstin', null)
      .ilike('legal_name', legalName)
      .maybeSingle<Customer>();

    if (data) return { ok: true, customer: data, created: false };
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      gstin,
      legal_name: legalName,
      entity_type: facts.entity_type ?? null,
      industry: facts.industry ?? null,
      location: facts.location ?? null,
      date_of_incorporation: facts.date_of_incorporation ?? null,
      created_by: createdBy,
    })
    .select(CUSTOMER_COLUMNS)
    .single<Customer>();

  if (error || !data) {
    // A unique violation here means somebody created the same customer between
    // the lookup above and this insert. That is the right outcome, not an
    // error — read theirs and carry on.
    if (error?.code === '23505' && gstin) {
      const { data: raced } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('gstin', gstin)
        .maybeSingle<Customer>();

      if (raced) return { ok: true, customer: raced, created: false };
    }
    return { ok: false, message: error?.message ?? 'The customer could not be created.' };
  }

  return { ok: true, customer: data, created: true };
}
