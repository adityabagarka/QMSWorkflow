'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';

export type CreateDealResult = { ok: false; message: string } | null;

/**
 * Creates a rollover case.
 *
 * Deliberately does NOT gate on industry, entity type or location. The
 * pre-approved plan workflow blocks progress when an insurer declines the
 * industry, because it is matching against fixed SKUs. A rollover goes to an
 * insurer's desk and a person decides, so appetite is shown as guidance beside
 * these fields and the deal proceeds regardless (ADR 0007).
 *
 * The only hard requirement is a customer name — everything else can be filled
 * in as the RM learns it, which is how these deals actually arrive.
 */
export async function createDeal(
  _previous: CreateDealResult,
  formData: FormData,
): Promise<CreateDealResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const customerName = String(formData.get('customer_name') ?? '').trim();
  if (!customerName) {
    return { ok: false, message: 'Enter the customer name to create the deal.' };
  }

  const expiry = String(formData.get('policy_expiry_date') ?? '').trim();

  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from('cases')
    .insert({
      customer_name: customerName,
      owner_user_id: session.userId,
      industry: String(formData.get('industry') ?? '').trim() || null,
      entity_type: String(formData.get('entity_type') ?? '').trim() || null,
      policy_expiry_date: expiry || null,
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
    payload: { customer_name: customerName },
  });

  await supabase.from('audit_log').insert({
    entity_type: 'cases',
    entity_id: data.id,
    action: 'create',
    actor_type: 'user',
    actor_id: session.userId,
    after: { customer_name: customerName, owner_user_id: session.userId },
  });

  redirect(`/deals/${data.id}`);
}
