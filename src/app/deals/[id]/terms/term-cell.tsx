'use client';

import { useEffect, useState } from 'react';
import type { SaveState, TermState } from './use-term-saves';

const STATE_LABEL: Partial<Record<SaveState, string>> = {
  dirty: 'unsaved',
  saving: 'saving…',
  saved: 'saved',
};

/**
 * One expiring term, and the decision about it.
 *
 * A view onto state the grid owns (see `useTermSaves`) rather than the owner of
 * it. That is the whole point: this component unmounts whenever its section is
 * collapsed, and when it owned the pending edit, collapsing a section threw the
 * edit away without a word.
 *
 * The cell is still the editor — a modal per benefit would mean fifty-eight
 * dialogs for a policy nobody could read automatically, which is the ordinary
 * case rather than the exception.
 */
export function TermCell({
  benefitKey,
  term,
  onEdit,
  onConfirm,
}: {
  benefitKey: string;
  term: TermState;
  onEdit: (value: string | null) => void;
  onConfirm: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.value ?? '');

  // Re-opening a cell starts from whatever is current, including a value that
  // arrived from a save that finished while this cell was unmounted.
  useEffect(() => {
    if (!editing) setDraft(term.value ?? '');
  }, [term.value, editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim() || null;
    if (next !== (term.value ?? null)) onEdit(next);
  }

  const badge = STATE_LABEL[term.state];

  if (editing) {
    return (
      <div className="terms__cell terms__cell--editing">
        <input
          className="terms__input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(term.value ?? '');
              setEditing(false);
            }
          }}
          onBlur={commit}
          aria-label={`Expiring value for ${benefitKey}`}
        />
        {term.evidence ? (
          <span className="terms__evidence terms__evidence--stale">
            Changing this drops the clause it was read from.
          </span>
        ) : null}
      </div>
    );
  }

  const className = [
    'terms__cell',
    term.reviewed ? '' : 'terms__cell--proposed',
    term.state === 'error' ? 'terms__cell--failed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <button
        className="terms__edit"
        type="button"
        onClick={() => {
          setDraft(term.value ?? '');
          setEditing(true);
        }}
      >
        {term.value ?? <span className="terms__unset">not stated</span>}
      </button>

      {term.evidence ? (
        <>
          <span className="terms__evidence">“{term.evidence}”</span>
          {term.evidencePage ? <span className="terms__page">page {term.evidencePage}</span> : null}
        </>
      ) : null}

      {!term.reviewed && term.value ? (
        <button className="terms__confirm" type="button" onClick={onConfirm}>
          confirm
        </button>
      ) : null}

      {badge ? <span className={`terms__state terms__state--${term.state}`}>{badge}</span> : null}
      {term.state === 'error' ? (
        <span className="terms__error">
          {term.message ?? 'Not saved.'}{' '}
          <button className="linkish" type="button" onClick={() => onEdit(term.value)}>
            retry
          </button>
        </span>
      ) : null}
    </div>
  );
}
