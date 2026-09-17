'use client';

import { useState } from 'react';

export type TermRow = {
  benefitKey: string;
  section: string;
  label: string;
  expiring: string | null;
  reviewed: boolean;
  /** Value per option id, present only where the option changes it. */
  overrides: Record<string, string>;
};

export type OptionColumn = { id: string; optionNo: number; name: string };

/**
 * The terms table.
 *
 * One CSS grid for the whole thing rather than a grid per section, so a value
 * always sits under its own heading whatever is open or closed. Misalignment
 * here would mean reading an option's term against the wrong column, which is
 * the most expensive misreading this screen can produce — an insurer quoting
 * the wrong cover.
 */
export function TermsGrid({
  rows,
  options,
  onRename,
}: {
  rows: TermRow[];
  options: OptionColumn[];
  onRename?: (optionId: string) => void;
}) {
  const sections = [...new Set(rows.map((r) => r.section))];
  const [closed, setClosed] = useState<Set<string>>(() => new Set(sections.slice(1)));

  function toggle(section: string) {
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  // Benefit label, expiring, then one column per option.
  const template = `minmax(190px, 1.3fr) minmax(150px, 1.4fr) ${options
    .map(() => 'minmax(150px, 1.4fr)')
    .join(' ')}`;

  return (
    <div className="terms">
      <div className="terms__grid" style={{ gridTemplateColumns: template }}>
        <div className="terms__head">
          <div>Benefit</div>
          <div>Expiring</div>
          {options.map((o) => (
            <div key={o.id}>
              Option {o.optionNo}
              <span className="opt-name">{o.name}</span>
              {onRename ? (
                <button className="terms__rename" type="button" onClick={() => onRename(o.id)}>
                  rename
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {sections.map((section) => {
          const sectionRows = rows.filter((r) => r.section === section);
          const changed = sectionRows.filter((r) =>
            options.some((o) => r.overrides[o.id] !== undefined),
          ).length;
          const unconfirmed = sectionRows.filter((r) => !r.reviewed).length;
          const isClosed = closed.has(section);

          return (
            <div key={section} style={{ display: 'contents' }}>
              <button
                className="terms__section"
                type="button"
                onClick={() => toggle(section)}
                aria-expanded={!isClosed}
              >
                <span className="terms__caret">{isClosed ? '▸' : '▾'}</span>
                <span className="terms__section-name">{section}</span>
                <span className="terms__section-count">
                  {sectionRows.length} benefits
                  {changed > 0 ? ` · ${changed} changed` : ''}
                  {unconfirmed > 0 ? ` · ${unconfirmed} to confirm` : ''}
                </span>
              </button>

              {isClosed
                ? null
                : sectionRows.map((row) => (
                    <div key={row.benefitKey} style={{ display: 'contents' }}>
                      <div className="terms__cell terms__cell--label">{row.label}</div>
                      <div className="terms__cell">
                        {row.expiring ?? <span className="terms__unset">not confirmed</span>}
                      </div>
                      {options.map((o) => {
                        const override = row.overrides[o.id];
                        return (
                          <div
                            key={o.id}
                            className={
                              override !== undefined
                                ? 'terms__cell terms__cell--changed'
                                : 'terms__cell'
                            }
                          >
                            {override !== undefined ? (
                              override
                            ) : (
                              <span className="terms__same">same as expiring</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
