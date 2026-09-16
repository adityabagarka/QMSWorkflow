'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { ROLES_REQUIRING_MANAGER, type Role } from '@/lib/auth/roles';

export type DecisionResult = { ok: true } | { ok: false; message: string };

/**
 * Approves or rejects an access request (§15).
 *
 * The real enforcement lives in app.decide_access_request(): it re-checks the
 * approver's role, refuses an Admin trying to mint a Super Admin, requires a
 * role and manager where §15 does, and writes app_users, access_requests and
 * audit_log in one transaction. The validation here exists to produce a decent
 * error message before a round trip, not to be the control.
 */
export async function decideAccessRequest(
  _previous: DecisionResult | null,
  formData: FormData,
): Promise<DecisionResult> {
  const requestId = String(formData.get('requestId') ?? '');
  const approve = formData.get('intent') === 'approve';
  const role = (formData.get('role') as Role | null) || null;
  const managerId = String(formData.get('managerId') ?? '') || null;
  const note = String(formData.get('note') ?? '') || null;

  if (!requestId) {
    return { ok: false, message: 'No request was selected.' };
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
  const { error } = await supabase.rpc('decide_access_request', {
    p_request_id: requestId,
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
