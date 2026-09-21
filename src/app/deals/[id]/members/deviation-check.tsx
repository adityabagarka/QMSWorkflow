'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { formatCount } from '@/lib/format';
import { detectDeviations, type DeviationResult } from './actions';

function CheckButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="button button--secondary" type="submit" disabled={pending}>
      {pending ? 'checking…' : label}
    </button>
  );
}

/**
 * The button that checks the roster against the expiring terms, and says what
 * happened.
 *
 * It used to be a bare server action whose return value was thrown away, so a
 * check that could not run — no expiring policy, no terms confirmed, a write
 * refused — looked exactly like one that ran and found nothing: the page came
 * back unchanged. The result is the whole point of pressing it.
 */
export function DeviationCheck({ dealId, hasFindings }: { dealId: string; hasFindings: boolean }) {
  const [result, submit] = useFormState<DeviationResult, FormData>(
    () => detectDeviations(dealId),
    null,
  );

  return (
    <form action={submit} style={{ marginTop: 28 }}>
      <CheckButton
        label={hasFindings ? 'check against the terms again' : 'check against the expiring terms'}
      />

      {result && !result.ok ? (
        <p className="ff__hint" style={{ marginTop: 10, color: 'var(--plum-red-deep)' }}>
          {result.message}
        </p>
      ) : null}

      {result?.ok && result.found === 0 ? (
        <p className="ff__hint" style={{ marginTop: 10 }}>
          Checked against {formatCount(result.termsRead)}{' '}
          {result.termsRead === 1 ? 'term' : 'terms'} on the expiring policy. Every life on the
          roster is inside them.
        </p>
      ) : null}
    </form>
  );
}
