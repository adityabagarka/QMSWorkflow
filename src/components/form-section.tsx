'use client';

import * as React from 'react';
import { useState } from 'react';

/**
 * A section that can be folded away.
 *
 * The two halves of this step are not equal. A company is a once-a-year fact —
 * looked at on the first deal and reviewed occasionally after — while the deal
 * is what every RFQ turns on. Showing both open, one after another, made a long
 * form out of a short one and buried the part that changes.
 */
export function Section({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={open ? 'formsec formsec--open' : 'formsec'}>
      <button
        className="formsec__toggle"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="formsec__caret">{open ? '▾' : '▸'}</span>
        <span className="formsec__title">{title}</span>
        {!open && summary ? <span className="formsec__summary">{summary}</span> : null}
      </button>

      {/*
        Always mounted, only hidden. Unmounting a folded section took its inputs
        out of the DOM, and `new FormData(form)` reads the DOM: a save made with
        the company folded away carried no legal name — so it was rejected as
        missing, and would have nulled the rest of the company had it passed.
      */}
      <div className="formsec__body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
