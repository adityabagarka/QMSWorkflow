'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { stageHref } from '@/lib/cases/phases';
import { normaliseGstin } from '@/lib/cases/customers';
import { looksLikeGstin } from '@/lib/cases/gstin';
import { deriveCoverStart, resolveCoverStart } from '@/lib/cases/cover-start';

export type SaveResult = { ok: true } | { ok: false; message: string } | null;

/**
 * Saves deal setup: the company, and the programme being rolled over.
 *
 * Two tables, because they are two different lifetimes. The company facts
 * belong to the customer and outlive this deal; the incumbent programme and the
 * dates belong to the case (ADR 0011 rule 4).
 *
 * Nothing here gates on industry or constitution. The pre-approved plan
 * workflow blocks a declined industry because it matches fixed SKUs; a rollover
 * goes to an insurer's desk and a person decides, so appetite is guidance and
 * the deal proceeds regardless (ADR 0007).
 */
export async function saveDealSetup(
  dealId: string,
  _prev: SaveResult,
  formData: FormData,
): Promise<SaveResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const text = (key: string) => String(formData.get(key) ?? '').trim() || null;

  const legalName = String(formData.get('legal_name') ?? '').trim();
  if (!legalName) {
    return { ok: false, message: 'A legal name is needed — it is what the policy is issued in.' };
  }

  // A GSTIN is an identifier, not a name. Pasting one into the name field is an
  // easy mistake and it ends up printed on the policy, so it is refused here as
  // well as by the check constraint behind it.
  if (looksLikeGstin(legalName)) {
    return {
      ok: false,
      message: 'That is a GSTIN, not a name. Put it in the GSTIN field and fetch the details.',
    };
  }

  const supabase = supabaseServer();

  // Which customer this deal is against is not editable here — changing it
  // would silently move the deal to a different company. Read it rather than
  // trusting the form.
  const { data: deal, error: dealError } = await supabase
    .from('cases')
    .select('customer_id, policy_expiry_date')
    .eq('id', dealId)
    .maybeSingle<{ customer_id: string; policy_expiry_date: string | null }>();

  if (dealError || !deal) {
    return { ok: false, message: dealError?.message ?? 'That deal could not be loaded.' };
  }

  const expiry = text('policy_expiry_date');

  // Recomputed from whatever expiry now says, so correcting the expiry date
  // moves the derivation with it and an override stays recognisable as one.
  const derived = deriveCoverStart(expiry);

  const coverStart = resolveCoverStart({
    coverStart: text('cover_start_date'),
    derived,
    reason: text('cover_start_change_reason'),
    note: text('cover_start_change_note'),
  });

  if (!coverStart.ok) return { ok: false, message: coverStart.message };

  const { error: customerError } = await supabase
    .from('customers')
    .update({
      legal_name: legalName,
      brand_name: text('brand_name') ?? legalName,
      gstin: normaliseGstin(text('gstin')),
      location: text('location'),
      entity_type: text('entity_type'),
      industry: text('industry'),
      date_of_incorporation: text('date_of_incorporation'),
    })
    .eq('id', deal.customer_id);

  if (customerError) {
    // The one failure worth naming: another company already holds this GSTIN,
    // which means either a typo or that these are the same company and the
    // deals should be merged. Neither is something to resolve silently.
    if (customerError.code === '23505') {
      return {
        ok: false,
        message:
          'Another customer already has that GSTIN. Check it, or pick that customer instead.',
      };
    }
    return { ok: false, message: customerError.message };
  }

  const { error: caseError } = await supabase
    .from('cases')
    .update({ policy_expiry_date: expiry, ...coverStart.value })
    .eq('id', dealId);

  if (caseError) return { ok: false, message: caseError.message };

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'deal_setup_saved',
    actor_type: 'user',
    actor_id: session.userId,
    // A shifted inception is the part of this worth finding later, so the
    // timeline carries the reason rather than only the fact of a save.
    payload: coverStart.value.cover_start_change_reason
      ? {
          cover_start_date: coverStart.value.cover_start_date,
          derived: coverStart.value.cover_start_derived_date,
          reason: coverStart.value.cover_start_change_reason,
          note: coverStart.value.cover_start_change_note,
        }
      : null,
  });

  revalidatePath(`/deals/${dealId}`);

  // Saving IS "next" on this step, so the action finishes the journey rather
  // than leaving the user on a saved form wondering whether to click again.
  // redirect() throws, so nothing below it runs — that is how Next signals a
  // navigation from a server action.
  redirect(stageHref(dealId, 2));
}
