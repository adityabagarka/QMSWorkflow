'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { findOrCreateCustomer, searchCustomers } from '@/lib/cases/customers';
import { deriveCoverStart } from '@/lib/cases/cover-start';
import { describeCompany } from '@/lib/format';

export type CreateDealResult = { ok: false; message: string } | null;

/** A customer as the picker shows it: enough to recognise, nothing more. */
export type CustomerMatch = {
  id: string;
  legal_name: string;
  gstin: string | null;
  description: string;
};

/**
 * Creates a rollover case.
 *
 * Deliberately does NOT gate on industry, entity type or location. The
 * pre-approved plan workflow blocks progress when an insurer declines the
 * industry, because it is matching against fixed SKUs. A rollover goes to an
 * insurer's desk and a person decides, so appetite is shown as guidance beside
 * these fields and the deal proceeds regardless (ADR 0007).
 *
 * The only hard requirement is a customer — picked from the ones we already
 * know, or named to create a new one. Everything else can be filled in as the
 * RM learns it, which is how these deals actually arrive.
 */
export async function createDeal(
  _previous: CreateDealResult,
  formData: FormData,
): Promise<CreateDealResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  // An existing customer picked from the search wins over anything typed: the
  // point of picking one is not to create a second record for a company we
  // already know.
  const pickedCustomerId = String(formData.get('customer_id') ?? '').trim();
  const customerName = String(formData.get('customer_name') ?? '').trim();

  if (!pickedCustomerId && !customerName) {
    return { ok: false, message: 'Pick an existing customer, or enter a name to create one.' };
  }

  const supabase = supabaseServer();

  let customerId = pickedCustomerId;
  if (!customerId) {
    const found = await findOrCreateCustomer(
      {
        legal_name: customerName,
        gstin: String(formData.get('gstin') ?? ''),
        industry: String(formData.get('industry') ?? '').trim() || null,
        entity_type: String(formData.get('entity_type') ?? '').trim() || null,
      },
      session.userId,
    );

    if (!found.ok) return { ok: false, message: found.message };
    customerId = found.customer.id;
  }

  const expiry = String(formData.get('policy_expiry_date') ?? '').trim() || null;

  const { data, error } = await supabase
    .from('cases')
    .insert({
      customer_id: customerId,
      owner_user_id: session.userId,
      policy_expiry_date: expiry,
      // Derived, not asked for: cover starts the day after the expiring policy
      // ends. Editable later, and a shift then has to say why (ADR 0011).
      cover_start_date: deriveCoverStart(expiry),
      cover_start_derived_date: deriveCoverStart(expiry),
      current_phase: 0,
      state: 'intake',
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !data) {
    return { ok: false, message: error?.message ?? 'The deal could not be created.' };
  }

  // The case timeline is the user-facing narrative; audit_log is the
  // compliance record. Both are append-only.
  await supabase.from('case_events').insert({
    case_id: data.id,
    event_type: 'case_created',
    actor_type: 'user',
    actor_id: session.userId,
    payload: { customer_id: customerId },
  });

  await supabase.from('audit_log').insert({
    entity_type: 'cases',
    entity_id: data.id,
    action: 'create',
    actor_type: 'user',
    actor_id: session.userId,
    after: { customer_id: customerId, owner_user_id: session.userId },
  });

  redirect(`/deals/${data.id}`);
}

/**
 * Backs the customer picker on a new deal.
 *
 * A server action rather than an API route: it goes through the same
 * RLS-bound client as everything else, so what comes back is what this user is
 * allowed to see, decided in the database rather than here.
 */
export async function findCustomers(query: string): Promise<CustomerMatch[]> {
  const session = await getSession();
  if (!session || session.status !== 'active') return [];

  const matches = await searchCustomers(query);
  return matches.map((c) => ({
    id: c.id,
    legal_name: c.legal_name,
    gstin: c.gstin,
    description: describeCompany([c.entity_type, c.industry, c.location]),
  }));
}
