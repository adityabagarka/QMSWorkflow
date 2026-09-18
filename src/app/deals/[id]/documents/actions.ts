'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { storagePath, type DocumentKind } from '@/lib/cases/documents';

export type UploadResult = { ok: true } | { ok: false; message: string } | null;

const BUCKET = 'case-documents';

/**
 * Stores a document against a deal.
 *
 * Nothing about this step is mandatory (ADR 0011 rule 1): a file that has not
 * arrived is a normal state, and the RFQ step is where the requirement bites.
 *
 * Re-uploading the same kind replaces what was there. The database enforces one
 * current file per kind, so this deletes first rather than relying on the
 * insert to sort it out — and it deletes the row before the object, because a
 * row pointing at a file that is gone is worse than a file nothing points at.
 */
export async function uploadDocument(
  dealId: string,
  _prev: UploadResult,
  formData: FormData,
): Promise<UploadResult> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return { ok: false, message: 'Your access is not active.' };
  }

  const kind = String(formData.get('kind') ?? '') as DocumentKind;
  const file = formData.get('file');

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a file to upload.' };
  }

  const supabase = supabaseServer();
  const path = storagePath(dealId, kind, file.name);

  // Uploaded before the row is written: if the upload fails there is nothing to
  // unwind, whereas a row written first would have to be cleaned up by hand.
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });

  if (uploadError) {
    return { ok: false, message: `The file could not be stored: ${uploadError.message}` };
  }

  if (kind !== 'other') {
    const { data: existing } = await supabase
      .from('case_documents')
      .select('id, file_ref')
      .eq('case_id', dealId)
      .eq('kind', kind)
      .returns<{ id: string; file_ref: string }[]>();

    for (const previous of existing ?? []) {
      await supabase.from('case_documents').delete().eq('id', previous.id);
      await supabase.storage.from(BUCKET).remove([previous.file_ref]);
    }
  }

  const { error } = await supabase.from('case_documents').insert({
    case_id: dealId,
    kind,
    file_ref: path,
    file_name: file.name,
    byte_size: file.size,
    content_type: file.type || null,
    uploaded_by: session.userId,
  });

  if (error) {
    // The row is the record; an object with no row is invisible, so it goes.
    await supabase.storage.from(BUCKET).remove([path]);
    return { ok: false, message: error.message };
  }

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'document_uploaded',
    actor_type: 'user',
    actor_id: session.userId,
    payload: { kind, file_name: file.name },
  });

  revalidatePath(`/deals/${dealId}/documents`);
  return { ok: true };
}

/** Removes a document. The file goes with the row — evidence, not litter. */
export async function removeDocument(dealId: string, documentId: string): Promise<void> {
  const session = await getSession();
  if (!session || session.status !== 'active') return;

  const supabase = supabaseServer();

  const { data: doc } = await supabase
    .from('case_documents')
    .select('file_ref, kind, file_name')
    .eq('id', documentId)
    .maybeSingle<{ file_ref: string; kind: string; file_name: string }>();

  if (!doc) return;

  const { error } = await supabase.from('case_documents').delete().eq('id', documentId);
  if (error) return;

  await supabase.storage.from(BUCKET).remove([doc.file_ref]);

  await supabase.from('case_events').insert({
    case_id: dealId,
    event_type: 'document_removed',
    actor_type: 'user',
    actor_id: session.userId,
    payload: { kind: doc.kind, file_name: doc.file_name },
  });

  revalidatePath(`/deals/${dealId}/documents`);
}

/**
 * A short-lived link to read a stored file.
 *
 * Minted per request rather than stored: the bucket is private, and a URL that
 * lives longer than the click that asked for it is a way out of the access
 * model (§15, §16).
 */
export async function documentUrl(fileRef: string): Promise<string | null> {
  const session = await getSession();
  if (!session || session.status !== 'active') return null;

  const supabase = supabaseServer();
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(fileRef, 60);
  return data?.signedUrl ?? null;
}
