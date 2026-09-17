'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';

export type SaveResult = { ok: true } | { ok: false; message: string } | null;

/**
 * Saves the company profile.
 *
 * Nothing here gates on industry or constitution. The pre-approved plan
 * workflow blocks a declined industry because it matches fixed SKUs; a rollover
 * goes to an insurer's desk and a person decides, so appetite is guidance and
 * the deal proceeds regardless (ADR 0007).
 */
export async function saveCompany(
  dealId: string,
  _prev: SaveResult,
  formData: FormData,
): Promise<SaveResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const customerName = String(formData.get('customer_name') ?? '').trim();
  if (!customerName) {
    return { ok: false, message: 'A legal name is needed — it is what the policy is issued in.' };
  }

  const text = (key: string) => String(formData.get(key) ?? '').trim() || null;

  const supabase = supabaseServer();
  const { error } = await supabase
    .from('cases')
    .update({
      customer_name: customerName,
      gstin: text('gstin'),
      location: text('location'),
      entity_type: text('entity_type'),
      industry: text('industry'),
      date_of_incorporation: text('date_of_incorporation'),
      cover_start_date: text('cover_start_date'),
    })
    .eq('id', dealId);

  if (error) return { ok: false, message: error.message };

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'company_profile_saved',
    actor_type: 'user',
    actor_id: session.userId,
  });

  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}
