'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';

export type DeleteResult = { ok: true } | { ok: false; message: string } | null;

/**
 * Throws away a deal nobody has put anything into.
 *
 * Picking a customer creates the deal immediately, so the document slots have
 * something to attach to. That is right for the person doing the work and wrong
 * for the database: every abandoned search leaves a row, and a list full of
 * half-started deals is worse than an extra click.
 *
 * Only a draft goes. The rule is in the database, not here (migration 0041): a
 * deal with a roster, claims, terms, documents or an RFQ is a record of work,
 * and deleting it would take the audit trail with it (§16). This code asks; RLS
 * decides.
 */
export async function deleteDraftDeal(dealId: string, _prev: DeleteResult): Promise<DeleteResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const supabase = supabaseServer();

  // Recorded before the row goes. `audit_log` outlives what it describes, which
  // is the point of it being append-only and separate.
  await supabase.from('audit_log').insert({
    entity_type: 'cases',
    entity_id: dealId,
    action: 'delete',
    actor_type: 'user',
    actor_id: session.userId,
    before: { deal_id: dealId, reason: 'draft discarded by owner' },
  });

  const { error, count } = await supabase.from('cases').delete({ count: 'exact' }).eq('id', dealId);

  if (error) return { ok: false, message: error.message };

  if (count === 0) {
    // RLS refused it, which here means the deal is no longer a draft.
    return {
      ok: false,
      message:
        'That deal has work on it now — a roster, terms or a document — so it cannot be discarded.',
    };
  }

  revalidatePath('/deals');
  return { ok: true };
}
