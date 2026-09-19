'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { deriveCoverStart, resolveCoverStart } from '@/lib/cases/cover-start';

export type ShiftResult = { ok: true } | { ok: false; message: string } | null;

/**
 * Moves the date cover starts on, and records why.
 *
 * Cover start is derived — the day after the expiring policy ends — so it is
 * not a field on any form. Almost every deal wants the derived date, and a
 * date field on the setup step meant asking a question whose answer was already
 * known, on every deal, to catch the few where it is not.
 *
 * Shifting it is therefore a deliberate act, taken from the summary where the
 * date is displayed, and the reason is the point: knowing that a fifth of
 * rollovers start late because the incumbent granted an extension is worth more
 * than the date itself.
 */
export async function shiftCoverStart(
  dealId: string,
  _prev: ShiftResult,
  formData: FormData,
): Promise<ShiftResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const text = (key: string) => String(formData.get(key) ?? '').trim() || null;

  const supabase = supabaseServer();

  const { data: deal } = await supabase
    .from('cases')
    .select('policy_expiry_date, cover_start_date')
    .eq('id', dealId)
    .maybeSingle<{ policy_expiry_date: string | null; cover_start_date: string | null }>();

  if (!deal) return { ok: false, message: 'That deal could not be loaded.' };

  const derived = deriveCoverStart(deal.policy_expiry_date);

  const resolved = resolveCoverStart({
    coverStart: text('cover_start_date'),
    derived,
    reason: text('cover_start_change_reason'),
    note: text('cover_start_change_note'),
  });

  if (!resolved.ok) return { ok: false, message: resolved.message };

  const { error } = await supabase.from('cases').update(resolved.value).eq('id', dealId);
  if (error) return { ok: false, message: error.message };

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'cover_start_shifted',
    actor_type: 'user',
    actor_id: session.userId,
    payload: {
      from: deal.cover_start_date,
      to: resolved.value.cover_start_date,
      derived,
      reason: resolved.value.cover_start_change_reason,
      note: resolved.value.cover_start_change_note,
    },
  });

  await supabase.from('audit_log').insert({
    entity_type: 'cases',
    entity_id: dealId,
    action: 'update',
    actor_type: 'user',
    actor_id: session.userId,
    before: { cover_start_date: deal.cover_start_date },
    after: resolved.value,
  });

  revalidatePath(`/deals/${dealId}`, 'layout');

  return { ok: true };
}
