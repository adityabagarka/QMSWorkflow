'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { CLAIM_FIELDS } from '@/lib/parsing/columns';
import type { ClaimsResult, Discrepancy, StatedFigure } from '@/lib/parsing/claims';
import { formatCount, formatRupees } from '@/lib/format';
import { loadClaims, type LoadClaimsResult } from './actions';

export const METRIC_LABELS: Record<string, string> = {
  claims_reported: 'Claims reported',
  claims_settled: 'Claims settled',
  claims_outstanding: 'Claims outstanding',
  claims_rejected: 'Claims rejected',
  amount_claimed: 'Amount claimed',
  amount_settled: 'Amount settled',
  amount_outstanding: 'Amount outstanding',
  premium: 'Premium',
  incurred_claims_ratio: 'Incurred claims ratio',
};

/** Counts are counts; everything else is money, except the ratio. */
export function formatMetric(metric: string, value: number): string {
  if (metric === 'incurred_claims_ratio') return `${value}%`;
  if (metric.startsWith('claims_')) return formatCount(value);
  return formatRupees(value);
}

function LoadButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'loading…' : `load ${formatCount(count)} claims`}
    </button>
  );
}

export function ClaimsReview({
  dealId,
  preview,
}: {
  dealId: string;
  preview: {
    result: ClaimsResult;
    headers: string[];
    fileName: string;
    stated: StatedFigure[];
    misFileName: string | null;
    discrepancies: Discrepancy[];
    premium: number | null;
  };
}) {
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [state, submit] = useFormState<LoadClaimsResult, FormData>(
    loadClaims.bind(null, dealId),
    null,
  );

  const { result, stated, discrepancies } = preview;
  const computed = result.computed;
  const disagreeing = new Set(discrepancies.map((d) => d.metric));

  function chosen(field: string): string {
    if (Object.prototype.hasOwnProperty.call(overrides, field)) return overrides[field] ?? '';
    return result.mapping.matches.find((m) => m.field === field)?.header ?? '';
  }

  const rows: { metric: string; computed: number | null; stated: number | null }[] = [
    { metric: 'claims_reported', computed: computed.claimsReported },
    { metric: 'claims_settled', computed: computed.claimsSettled },
    { metric: 'claims_outstanding', computed: computed.claimsOutstanding },
    { metric: 'claims_rejected', computed: computed.claimsRejected },
    { metric: 'amount_claimed', computed: computed.amountClaimed },
    { metric: 'amount_settled', computed: computed.amountSettled },
    { metric: 'amount_outstanding', computed: computed.amountOutstanding },
    { metric: 'incurred_claims_ratio', computed: computed.incurredClaimsRatio },
  ].map((r) => ({
    ...r,
    stated: stated.find((s) => s.metric === r.metric)?.value ?? null,
  }));

  return (
    <div>
      <p className="standfirst">
        {preview.fileName} · {formatCount(result.claims.length)} claims
        {preview.misFileName ? ` · ${preview.misFileName}` : ' · no MIS uploaded'}
      </p>

      <h3 style={{ marginTop: 28 }}>Columns</h3>
      <div className="maptable">
        {CLAIM_FIELDS.map((spec) => (
          <div key={spec.field} className="maptable__row">
            <div className="maptable__field">{spec.label}</div>
            <select
              className="ff__control"
              value={chosen(spec.field)}
              onChange={(e) =>
                setOverrides((o) => ({ ...o, [spec.field]: e.target.value || null }))
              }
            >
              <option value="">Not in this file</option>
              {preview.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <div className="maptable__note">
              {result.mapping.matches.find((m) => m.field === spec.field)?.confidence === 'likely'
                ? 'guessed'
                : ''}
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 32 }}>The history, both ways</h3>
      <p className="ff__hint" style={{ maxWidth: '64ch' }}>
        What the dump adds up to, beside what the insurer&rsquo;s MIS says about the same period.
      </p>

      <table className="bandtable">
        <thead>
          <tr>
            <th>&nbsp;</th>
            <th>From the dump</th>
            <th>The MIS says</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.metric} className={disagreeing.has(row.metric) ? 'is-gap' : undefined}>
              <td>{METRIC_LABELS[row.metric]}</td>
              <td>{row.computed === null ? '—' : formatMetric(row.metric, row.computed)}</td>
              <td className={row.stated === null ? 'cell-muted' : undefined}>
                {row.stated === null ? 'not stated' : formatMetric(row.metric, row.stated)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {computed.incurredClaimsRatio === null ? (
        <p className="ff__hint" style={{ marginTop: 12 }}>
          The ratio needs the expiring premium, which is on deal setup.
        </p>
      ) : null}

      {discrepancies.length > 0 ? (
        <div className="notice notice--error" style={{ marginTop: 24 }}>
          <p style={{ margin: 0 }}>
            {discrepancies.length === 1
              ? 'One figure disagrees.'
              : `${discrepancies.length} figures disagree.`}{' '}
            You will be asked to choose between them after loading — the RFQ cannot be built until
            you have.
          </p>
        </div>
      ) : null}

      {result.issues.length > 0 ? (
        <>
          <h3 style={{ marginTop: 32 }}>Worth a look</h3>
          <ul className="issues issues--soft">
            {result.issues.slice(0, 20).map((issue, i) => (
              <li key={i}>
                <span className="issues__row">Row {issue.rowNumber}</span>
                {issue.detail}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <form action={submit} style={{ marginTop: 32 }}>
        <input type="hidden" name="overrides" value={JSON.stringify(overrides)} />
        {state && !state.ok ? (
          <p style={{ color: 'var(--plum-red-deep)', fontSize: 13.5 }}>{state.message}</p>
        ) : null}
        <LoadButton count={result.claims.length} />
      </form>
    </div>
  );
}
