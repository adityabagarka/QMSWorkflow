'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveTerm } from './actions';

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export type TermState = {
  value: string | null;
  state: SaveState;
  message?: string;
  /** Dropped once a proposed value is changed: the clause supported the old one. */
  evidence: string | null;
  evidencePage: number | null;
  reviewed: boolean;
};

/**
 * Every pending edit on the terms grid, held above the cells.
 *
 * The cells used to own this, and saved on blur. Collapsing a section or
 * stepping away unmounted the cell, and an edit that had not yet dispatched
 * went with it — silently, because the component that would have shown the
 * error no longer existed. On a real deal that lost a whole screen of typing.
 *
 * So the queue lives here, above anything that unmounts, and it drains on its
 * own. A cell is a view onto this state, not the owner of it.
 */
export function useTermSaves(
  dealId: string,
  initial: Map<string, TermState>,
): {
  terms: Map<string, TermState>;
  edit: (benefitKey: string, value: string | null) => void;
  confirm: (benefitKey: string) => void;
  pending: number;
  failed: number;
} {
  const [terms, setTerms] = useState(initial);

  // What still has to reach the database. Kept in a ref rather than state so
  // the drain loop is not restarted by every keystroke.
  const queue = useRef(new Map<string, { value: string | null; agreeing: boolean }>());
  const draining = useRef(false);

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;

    try {
      while (queue.current.size > 0) {
        const [benefitKey, job] = queue.current.entries().next().value as [
          string,
          { value: string | null; agreeing: boolean },
        ];
        queue.current.delete(benefitKey);

        setTerms((prev) => {
          const next = new Map(prev);
          const cur = next.get(benefitKey);
          if (cur) next.set(benefitKey, { ...cur, state: 'saving' });
          return next;
        });

        const result = await saveTerm(dealId, benefitKey, job.value);

        setTerms((prev) => {
          const next = new Map(prev);
          const cur = next.get(benefitKey);
          if (!cur) return prev;

          // A newer edit arrived while this one was in flight; leave it dirty
          // so the queue picks it up rather than reporting a stale success.
          if (queue.current.has(benefitKey)) return prev;

          next.set(
            benefitKey,
            result.ok
              ? {
                  ...cur,
                  value: result.value,
                  state: 'saved',
                  message: undefined,
                  reviewed: true,
                  evidence: job.agreeing ? cur.evidence : null,
                  evidencePage: job.agreeing ? cur.evidencePage : null,
                }
              : { ...cur, state: 'error', message: result.message },
          );
          return next;
        });
      }
    } finally {
      draining.current = false;
    }
  }, [dealId]);

  const enqueue = useCallback(
    (benefitKey: string, value: string | null, agreeing: boolean) => {
      queue.current.set(benefitKey, { value, agreeing });
      setTerms((prev) => {
        const next = new Map(prev);
        const cur = next.get(benefitKey);
        if (cur) next.set(benefitKey, { ...cur, value, state: 'dirty' });
        return next;
      });
      void drain();
    },
    [drain],
  );

  const edit = useCallback(
    (benefitKey: string, value: string | null) => enqueue(benefitKey, value, false),
    [enqueue],
  );

  const confirm = useCallback(
    (benefitKey: string) => {
      const cur = terms.get(benefitKey);
      enqueue(benefitKey, cur?.value ?? null, true);
    },
    [enqueue, terms],
  );

  const pending = [...terms.values()].filter(
    (t) => t.state === 'dirty' || t.state === 'saving',
  ).length;
  const failed = [...terms.values()].filter((t) => t.state === 'error').length;

  /*
   * The last line of defence. Everything above makes a lost edit unlikely; this
   * makes losing one to a closed tab impossible to do silently.
   */
  useEffect(() => {
    if (pending === 0 && failed === 0) return;

    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, failed]);

  return { terms, edit, confirm, pending, failed };
}
