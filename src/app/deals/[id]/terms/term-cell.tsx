'use client';

import { useState, useTransition } from 'react';
import { saveTerm } from './actions';

/**
 * One expiring term, and the decision about it.
 *
 * The cell is the editor. A separate form, or a modal per benefit, would mean
 * fifty-eight round trips through a dialog for a policy nobody could read
 * automatically — which is the ordinary case, not the exception.
 *
 * A proposed value shows `confirm` beside it. Confirming is one click and is
 * not the same as retyping the same words: it records agreement with what the
 * policy was read to say, and the clause behind it survives. Changing the value
 * is a correction, and the clause does not survive, because it was evidence for
 * a different reading.
 */
export function TermCell({
  dealId,
  benefitKey,
  value,
  reviewed,
  evidence,
  evidencePage,
}: {
  dealId: string;
  benefitKey: string;
  value: string | null;
  reviewed: boolean;
  evidence: string | null;
  evidencePage: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [shown, setShown] = useState(value);
  const [keptEvidence, setKeptEvidence] = useState(evidence);
  const [settled, setSettled] = useState(reviewed);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function commit(next: string | null, agreeing: boolean) {
    setError(null);
    startSaving(async () => {
      const result = await saveTerm(dealId, benefitKey, next);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setShown(result.value);
      setSettled(true);
      setEditing(false);
      // A corrected value is no longer supported by the clause the model read.
      if (!agreeing) setKeptEvidence(null);
    });
  }

  if (editing) {
    return (
      <div className="terms__cell terms__cell--editing">
        <input
          className="terms__input"
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft, false);
            if (e.key === 'Escape') {
              setDraft(shown ?? '');
              setEditing(false);
            }
          }}
          onBlur={() => commit(draft, false)}
          aria-label={`Expiring value for ${benefitKey}`}
        />
        {keptEvidence ? (
          <span className="terms__evidence terms__evidence--stale">
            Changing this drops the clause it was read from.
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={settled ? 'terms__cell' : 'terms__cell terms__cell--proposed'}>
      <button
        className="terms__edit"
        type="button"
        disabled={saving}
        onClick={() => {
          setDraft(shown ?? '');
          setEditing(true);
        }}
      >
        {shown ?? <span className="terms__unset">not stated</span>}
      </button>

      {keptEvidence ? (
        <>
          <span className="terms__evidence">“{keptEvidence}”</span>
          {evidencePage ? <span className="terms__page">page {evidencePage}</span> : null}
        </>
      ) : null}

      {!settled ? (
        <button
          className="terms__confirm"
          type="button"
          disabled={saving}
          onClick={() => commit(shown, true)}
        >
          {saving ? 'saving…' : 'confirm'}
        </button>
      ) : null}

      {error ? <span className="terms__error">{error}</span> : null}
    </div>
  );
}
