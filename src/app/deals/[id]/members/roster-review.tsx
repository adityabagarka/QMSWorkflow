'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { MEMBER_FIELDS } from '@/lib/parsing/columns';
import { summariseRoster, type RosterResult } from '@/lib/parsing/roster';
import { formatCount } from '@/lib/format';
import { loadRoster, type LoadResult } from './actions';

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Employees',
  spouse: 'Spouses',
  child: 'Children',
  parent: 'Parents',
  parent_in_law: 'Parents-in-law',
  sibling: 'Siblings',
};

function LoadButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'loading…' : `load ${formatCount(count)} lives`}
    </button>
  );
}

/**
 * What the file says, before any of it is kept.
 *
 * The mapping is shown first and is editable, because everything below it is
 * only as right as the columns it was read through — and a roster read through
 * the wrong column is wrong in a way that looks entirely plausible.
 */
export function RosterReview({
  dealId,
  result,
  headers,
  fileName,
  asOfLabel,
}: {
  dealId: string;
  result: RosterResult;
  headers: string[];
  fileName: string;
  asOfLabel: string;
}) {
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [state, submit] = useFormState<LoadResult, FormData>(loadRoster.bind(null, dealId), null);

  const summary = summariseRoster(result.members);
  const blocking = result.issues.filter((i) => i.blocking);
  const warnings = result.issues.filter((i) => !i.blocking);

  function chosen(field: string): string {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) return overrides[field] ?? '';
    return result.mapping.matches.find((m) => m.field === field)?.header ?? '';
  }

  return (
    <div>
      <p className="standfirst">
        {fileName} · {formatCount(result.counts.rows)} rows · ages at {asOfLabel}
      </p>

      <h3 style={{ marginTop: 28 }}>Columns</h3>
      <p className="ff__hint" style={{ maxWidth: '62ch' }}>
        Change any of these if a column was read as the wrong thing.
      </p>

      <div className="maptable">
        {MEMBER_FIELDS.map((spec) => {
          const match = result.mapping.matches.find((m) => m.field === spec.field);
          return (
            <div key={spec.field} className="maptable__row">
              <div className="maptable__field">
                {spec.label}
                {spec.required ? <span className="maptable__req">required</span> : null}
              </div>
              <select
                className="ff__control"
                value={chosen(spec.field)}
                onChange={(e) =>
                  setOverrides((o) => ({ ...o, [spec.field]: e.target.value || null }))
                }
              >
                <option value="">Not in this file</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <div className="maptable__note">
                {match?.confidence === 'likely' ? 'guessed' : ''}
              </div>
            </div>
          );
        })}
      </div>

      {result.assumptions.length > 0 ? (
        <div className="notice" style={{ marginTop: 20 }}>
          <ul className="plainlist">
            {result.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 style={{ marginTop: 32 }}>What is in it</h3>
      <div className="demog">
        <div className="demog__stat">
          <span className="label">Lives</span>
          <span className="figure">{formatCount(summary.lives)}</span>
        </div>
        {Object.entries(summary.byRelationship).map(([relationship, count]) => (
          <div key={relationship} className="demog__stat">
            <span className="label">{RELATIONSHIP_LABELS[relationship] ?? relationship}</span>
            <span className="figure">{formatCount(count)}</span>
          </div>
        ))}
        <div className="demog__stat">
          <span className="label">Average age</span>
          <span className="figure">{summary.averageAge ?? '—'}</span>
        </div>
      </div>

      {Object.keys(summary.byAgeBand).length > 0 ? (
        <table className="bandtable">
          <thead>
            <tr>
              <th>Age band</th>
              <th>Lives</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(summary.byAgeBand).map(([band, count]) => (
              <tr key={band}>
                <td>{band}</td>
                <td>{formatCount(count)}</td>
                <td className="cell-muted">
                  {Math.round((count / Math.max(summary.lives, 1)) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {blocking.length > 0 ? (
        <>
          <h3 style={{ marginTop: 32 }}>Rows that cannot be loaded</h3>
          <p className="ff__hint" style={{ maxWidth: '62ch' }}>
            These are left out. Correct them in the file and upload it again to bring them in.
          </p>
          <ul className="issues">
            {blocking.slice(0, 25).map((issue, i) => (
              <li key={i}>
                <span className="issues__row">Row {issue.rowNumber}</span>
                {issue.detail}
              </li>
            ))}
          </ul>
          {blocking.length > 25 ? (
            <p className="ff__hint">and {blocking.length - 25} more.</p>
          ) : null}
        </>
      ) : null}

      {warnings.length > 0 ? (
        <>
          <h3 style={{ marginTop: 32 }}>Worth a look</h3>
          <ul className="issues issues--soft">
            {warnings.slice(0, 25).map((issue, i) => (
              <li key={i}>
                <span className="issues__row">Row {issue.rowNumber}</span>
                {issue.detail}
              </li>
            ))}
          </ul>
          {warnings.length > 25 ? (
            <p className="ff__hint">and {warnings.length - 25} more.</p>
          ) : null}
        </>
      ) : null}

      <form action={submit} style={{ marginTop: 32 }}>
        <input type="hidden" name="overrides" value={JSON.stringify(overrides)} />
        {state && !state.ok ? (
          <p style={{ color: 'var(--plum-red-deep)', fontSize: 13.5 }}>{state.message}</p>
        ) : null}
        <LoadButton count={result.counts.read} />
      </form>
    </div>
  );
}
