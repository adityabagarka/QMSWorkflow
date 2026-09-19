'use client';

import { useEffect, useState } from 'react';
import { goToPolicyPage } from './policy-view';
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
  suggestions,
  inputKind,
  onEdit,
  onConfirm,
}: {
  benefitKey: string;
  term: TermState;
  /** The seeded vocabulary plus whatever real deals have used. */
  suggestions: string[];
  inputKind: 'choice' | 'amount' | 'text';
  onEdit: (value: string | null) => void;
  onConfirm: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(term.value ?? '');
  const [highlighted, setHighlighted] = useState(-1);

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
    /*
     * Suggestions filter as you type, and anything not in the list is still a
     * valid answer — a bespoke policy is a real thing, it just should not be
     * the default path when the answer is one of four words.
     */
    const needle = draft.trim().toLowerCase();
    const offered = suggestions
      .filter((s) => needle === '' || s.toLowerCase().includes(needle))
      .filter((s) => s.toLowerCase() !== needle)
      .slice(0, 8);

    function choose(value: string) {
      setDraft(value);
      setEditing(false);
      setHighlighted(-1);
      if (value !== (term.value ?? null)) onEdit(value);
    }

    return (
      <div className="terms__cell terms__cell--editing">
        <span className="typeahead">
          <input
            className="terms__input"
            autoFocus
            value={draft}
            inputMode={inputKind === 'amount' ? 'text' : undefined}
            onChange={(e) => {
              setDraft(e.target.value);
              setHighlighted(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlighted((i) => Math.min(i + 1, offered.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlighted((i) => Math.max(i - 1, -1));
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const picked = offered[highlighted];
                if (picked) choose(picked);
                else commit();
                return;
              }
              if (e.key === 'Escape') {
                setDraft(term.value ?? '');
                setEditing(false);
                setHighlighted(-1);
              }
            }}
            onBlur={commit}
            aria-label={`Expiring value for ${benefitKey}`}
          />

          {offered.length > 0 ? (
            <ul className="typeahead__list">
              {offered.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    className={i === highlighted ? 'is-active' : undefined}
                    // Not onClick alone: clicking blurs the input, and the blur
                    // commit would close the list before the click landed.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(s)}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </span>

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
          {term.evidencePage ? (
            // The clause is quoted here; this takes the panel to where it sits,
            // which is the difference between evidence and a footnote.
            <button
              className="terms__page terms__page--link"
              type="button"
              onClick={() => goToPolicyPage(term.evidencePage!)}
            >
              page {term.evidencePage}
            </button>
          ) : null}
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
