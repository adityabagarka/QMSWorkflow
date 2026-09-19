'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { deleteDraftDeal, type DeleteResult } from './delete-draft';

function DiscardButton() {
  const { pending } = useFormStatus();
  return (
    <button className="linkish" type="submit" disabled={pending}>
      {pending ? 'discarding…' : 'discard'}
    </button>
  );
}

/**
 * The control for throwing away a deal nobody started.
 *
 * Shown only on drafts, and only to somebody who can write the deal. It is
 * deliberately a quiet link rather than a button: discarding is the rare case,
 * and the row is there to be opened.
 */
export function DiscardDraft({ dealId }: { dealId: string }) {
  const [result, submit] = useFormState<DeleteResult, FormData>(
    () => deleteDraftDeal(dealId, null),
    null,
  );

  return (
    <form action={submit}>
      <DiscardButton />
      {result && !result.ok ? <div className="terms__error">{result.message}</div> : null}
    </form>
  );
}
