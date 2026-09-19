'use client';

import { useState } from 'react';
import { TermCell } from './term-cell';
import { useTermSaves, type TermState } from './use-term-saves';

export type ChangeKind = 'enhancement' | 'restriction' | 'changed';

export type OptionCell = {
  /** Always the full term, never a reference back to the expiring column. */
  value: string | null;
  changed: boolean;
  kind: ChangeKind | null;
};

export type TermRow = {
  benefitKey: string;
  section: string;
  label: string;
  expiring: string | null;
  reviewed: boolean;
  /** The clause this value was read from, when a model read it. */
  evidence: string | null;
  evidencePage: number | null;
  cells: Record<string, OptionCell>;
};

export type OptionColumn = { id: string; optionNo: number; name: string };

const MARK: Record<ChangeKind, string> = {
  enhancement: '↑ enhancement',
  restriction: '↓ restriction',
  changed: '• changed',
};

/**
 * The terms table.
 *
 * Two things here are load-bearing.
 *
 * One CSS grid for the whole table rather than a grid per section, so a value
 * always sits under its own heading whatever is open or closed. Reading an
 * option's term against the wrong column means an insurer quoting the wrong
 * cover.
 *
 * Every option shows the FULL term, including where it matches the expiring
 * policy. "Same as expiring" is fine on screen and useless everywhere else:
 * this table is exported to Excel, and an insurer issuing a policy from it
 * needs the words, not a cross-reference.
 */
export function TermsGrid({
  dealId,
  rows,
  options,
  onRename,
}: {
  dealId: string;
  rows: TermRow[];
  options: OptionColumn[];
  onRename?: (optionId: string) => void;
}) {
  /*
   * Every pending edit lives here, above the cells. A cell unmounts whenever
   * its section is collapsed, and while the cell owned its own pending save,
   * collapsing a section discarded the typing in it.
   */
  const { terms, edit, confirm, pending, failed } = useTermSaves(
    dealId,
    new Map<string, TermState>(
      rows.map((r) => [
        r.benefitKey,
        {
          value: r.expiring,
          state: 'clean',
          evidence: r.evidence,
          evidencePage: r.evidencePage,
          reviewed: r.reviewed,
        },
      ]),
    ),
  );

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

  const template = `minmax(190px, 1.2fr) minmax(160px, 1.3fr) ${options
    .map(() => 'minmax(160px, 1.3fr)')
    .join(' ')}`;

  return (
    <>
      {/* Saving is continuous, so the only thing worth stating is whether
          anything has not reached the database yet. */}
      {pending > 0 || failed > 0 ? (
        <p className={failed > 0 ? 'terms__pending terms__pending--bad' : 'terms__pending'}>
          {failed > 0
            ? `${failed} ${failed === 1 ? 'term' : 'terms'} did not save`
            : `Saving ${pending}…`}
        </p>
      ) : null}

      {options.length === 0 ? null : (
        <p className="terms__key">
          <span>
            <i className="k-enh" />
            Enhancement — more cover, expect it to cost
          </span>
          <span>
            <i className="k-res" />
            Restriction — less cover, ask for a discount
          </span>
          <span>
            <i className="k-chg" />
            Changed — direction is a judgement call
          </span>
        </p>
      )}

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
              options.some((o) => r.cells[o.id]?.changed),
            ).length;
            const unconfirmed = sectionRows.filter(
              (r) => !(terms.get(r.benefitKey)?.reviewed ?? r.reviewed),
            ).length;
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
                        <TermCell
                          benefitKey={row.benefitKey}
                          term={
                            terms.get(row.benefitKey) ?? {
                              value: row.expiring,
                              state: 'clean',
                              evidence: row.evidence,
                              evidencePage: row.evidencePage,
                              reviewed: row.reviewed,
                            }
                          }
                          onEdit={(v) => edit(row.benefitKey, v)}
                          onConfirm={() => confirm(row.benefitKey)}
                        />
                        {options.map((o) => {
                          const cell = row.cells[o.id];
                          const kind = cell?.kind ?? 'changed';
                          const className = !cell?.changed
                            ? 'terms__cell'
                            : `terms__cell terms__cell--${kind}`;

                          return (
                            <div key={o.id} className={className}>
                              {cell?.value ?? <span className="terms__unset">not confirmed</span>}
                              {cell?.changed ? (
                                <span className={`terms__mark terms__mark--${kind}`}>
                                  {MARK[kind]}
                                </span>
                              ) : null}
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
    </>
  );
}
