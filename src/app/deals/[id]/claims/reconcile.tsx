'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { formatDateTime } from '@/lib/format';
import { METRIC_LABELS, formatMetric } from './claims-review';
import { resolveDiscrepancy, type ResolveResult } from './actions';

export type Reconciliation = {
  metric: string;
  stated_value: number;
  computed_value: number;
  chosen: string | null;
  chosen_value: number | null;
  note: string | null;
  decided_at: string | null;
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'saving…' : 'use this figure'}
    </button>
  );
}

/**
 * One disagreement, and the choice it demands.
 *
 * Both figures are given equal weight on screen and neither is preselected.
 * That is the point of the whole mechanism: a default would be read as a
 * recommendation, and people would stop looking at the gap — which is often the
 * most negotiable thing in the file (ADR 0011 rule 5).
 */
export function ReconcileRow({ dealId, row }: { dealId: string; row: Reconciliation }) {
  const [choice, setChoice] = useState(row.chosen ?? '');
  const [state, submit] = useFormState<ResolveResult, FormData>(
    resolveDiscrepancy.bind(null, dealId, row.metric),
    null,
  );

  const settled = Boolean(row.chosen);
  const label = METRIC_LABELS[row.metric] ?? row.metric;

  if (settled) {
    return (
      <div className="recon recon--settled">
        <div className="recon__head">
          <div className="recon__metric">{label}</div>
          <span className="chip chip--settled">decided</span>
        </div>
        <p className="recon__outcome">
          Quoting on {formatMetric(row.metric, row.chosen_value ?? 0)} —{' '}
          {row.chosen === 'stated'
            ? "the insurer's figure"
            : row.chosen === 'computed'
              ? 'what their dump adds up to'
              : 'neither of theirs'}
          {row.decided_at ? `, ${formatDateTime(row.decided_at)}` : ''}.
        </p>
        {row.note ? <p className="recon__note">{row.note}</p> : null}
      </div>
    );
  }

  return (
    <form className="recon" action={submit}>
      <div className="recon__head">
        <div className="recon__metric">{label}</div>
      </div>

      <div className="recon__options">
        <label className={choice === 'computed' ? 'recon__opt is-picked' : 'recon__opt'}>
          <input
            type="radio"
            name="chosen"
            value="computed"
            checked={choice === 'computed'}
            onChange={() => setChoice('computed')}
          />
          <span className="recon__figure">{formatMetric(row.metric, row.computed_value)}</span>
          <span className="recon__source">what their dump adds up to</span>
        </label>

        <label className={choice === 'stated' ? 'recon__opt is-picked' : 'recon__opt'}>
          <input
            type="radio"
            name="chosen"
            value="stated"
            checked={choice === 'stated'}
            onChange={() => setChoice('stated')}
          />
          <span className="recon__figure">{formatMetric(row.metric, row.stated_value)}</span>
          <span className="recon__source">what their MIS states</span>
        </label>

        <label className={choice === 'neither' ? 'recon__opt is-picked' : 'recon__opt'}>
          <input
            type="radio"
            name="chosen"
            value="neither"
            checked={choice === 'neither'}
            onChange={() => setChoice('neither')}
          />
          <span className="recon__figure">Neither</span>
          <span className="recon__source">give the figure you are quoting on</span>
        </label>
      </div>

      {choice === 'neither' ? (
        <input className="ff__control" name="own_value" placeholder="Figure" inputMode="decimal" />
      ) : null}

      <input
        className="ff__control"
        name="note"
        placeholder={choice === 'neither' ? 'Why neither is right' : 'Why (optional)'}
        style={{ marginTop: 10 }}
      />

      {state && !state.ok ? <p className="recon__error">{state.message}</p> : null}

      <div style={{ marginTop: 12 }}>{choice ? <SaveButton /> : null}</div>
    </form>
  );
}
