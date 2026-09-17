'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createDeal, type CreateDealResult } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'creating…' : 'create deal'}
    </button>
  );
}

export function DealForm({
  industries,
  entityTypes,
}: {
  industries: string[];
  entityTypes: string[];
}) {
  const [result, submit] = useFormState<CreateDealResult, FormData>(createDeal, null);
  const [industry, setIndustry] = useState('');
  const [entityType, setEntityType] = useState('');

  return (
    <form action={submit} style={{ maxWidth: 560 }}>
      <label className="field">
        <span className="field__label">Customer name</span>
        <input type="text" name="customer_name" required autoComplete="off" />
      </label>

      <label className="field">
        <span className="field__label">Policy expiry date</span>
        <input type="date" name="policy_expiry_date" />
        <span className="field__hint">
          Drives the reminder cascade later — a deal expiring inside the reminder window is handled
          differently.
        </span>
      </label>

      <label className="field">
        <span className="field__label">Industry</span>
        <select name="industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>
          <option value="">Not known yet</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Constitution</span>
        <select
          name="entity_type"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
        >
          <option value="">Not known yet</option>
          {entityTypes.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>

      <p className="field__hint" style={{ maxWidth: '58ch' }}>
        Industry and constitution are recorded for guidance, not as gates. Insurers decide on a
        rollover case at their own desk, so a deal proceeds whatever these say — the guidance
        opposite only tells you what to expect.
      </p>

      {result && !result.ok ? (
        <p style={{ color: 'var(--plum-red-deep)', fontSize: 14 }}>{result.message}</p>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <SubmitButton />
      </div>
    </form>
  );
}
