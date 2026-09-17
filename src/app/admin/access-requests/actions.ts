'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { ROLES_REQUIRING_MANAGER, type Role } from '@/lib/auth/roles';

export type DecisionResult = { ok: true } | { ok: false; message: string } | null;

/**
 * Approves or rejects a person's access (§15).
 *
 * Acts on the user, not on a request row. The queue used to be built from
 * access_requests, which stranded anyone whose request row was missing or
 * already resolved — they vanished from the screen with no way to act on them.
 * `app_users.status = 'pending'` is the durable fact.
 *
 * Enforcement is in app.decide_user_access(): it re-checks the approver's role,
 * refuses a self-decision, refuses an Admin granting Super Admin, requires a
 * manager where §15's span computation needs one, and writes app_users,
 * access_requests and audit_log in one transaction. The checks here only buy a
 * better message before the round trip.
 */
export async function decideUserAccess(
  _previous: DecisionResult,
  formData: FormData,
): Promise<DecisionResult> {
  const userId = String(formData.get('userId') ?? '');
  const approve = formData.get('intent') === 'approve';
  const role = (formData.get('role') as Role | null) || null;
  const managerId = String(formData.get('managerId') ?? '') || null;
  const note = String(formData.get('note') ?? '') || null;

  if (!userId) {
    return { ok: false, message: 'No person was selected.' };
  }

  if (approve) {
    if (!role) {
      return { ok: false, message: 'Assign a role before approving.' };
    }
    if (!managerId && ROLES_REQUIRING_MANAGER.includes(role)) {
      return {
        ok: false,
        message:
          'Assign a manager as well — deal visibility for this role is computed from the reporting line.',
      };
    }
  }

  const supabase = supabaseServer();
  const { error } = await supabase.rpc('decide_user_access', {
    p_user_id: userId,
    p_approve: approve,
    p_role: approve ? role : null,
    p_manager_id: approve ? managerId : null,
    p_note: note,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath('/admin/access-requests');
  return { ok: true };
}
