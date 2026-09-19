'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { readPolicyFactsFor, type FactsResult, type SuggestedFact } from './read-policy-facts';

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button button--secondary" type="submit" disabled={pending}>
      {pending ? 'reading…' : 'read the policy copy'}
    </button>
  );
}

/** Which form field each fact belongs to, and what to call it on screen. */
const FIELDS: { key: string; label: string; field?: string }[] = [
  { key: 'policyholderName', label: 'Legal name', field: 'legal_name' },
  { key: 'gstin', label: 'GSTIN', field: 'gstin' },
  { key: 'insurerName', label: 'Incumbent insurer', field: 'insurer_name' },
  { key: 'brokerName', label: 'Incumbent broker', field: 'broker_name' },
  { key: 'tpaName', label: 'TPA', field: 'tpa_name' },
  { key: 'policyEnd', label: 'Policy expires', field: 'policy_expiry_date' },
  { key: 'premium', label: 'Expiring premium', field: 'expiring_premium' },
  { key: 'sumInsured', label: 'Sum insured' },
  { key: 'policyStart', label: 'Policy starts' },
  { key: 'policyNumber', label: 'Policy number' },
  { key: 'lives', label: 'Lives' },
];

/**
 * What the policy copy says, offered rather than applied.
 *
 * No model and no key — these are labelled values on a schedule and rules read
 * them for nothing. What they are not is authoritative: a schedule can carry an
 * address three renewals old, and the GSTN register beats it wherever the two
 * disagree (ADR 0011 rule 4). So every value arrives as a suggestion with the
 * line it was read from, and a person puts it into the form or does not.
 */
export function PolicyFactsPanel({
  dealId,
  onApply,
}: {
  dealId: string;
  /** Puts a value into the form field it belongs to. */
  onApply: (field: string, value: string) => void;
}) {
  const [result, submit] = useFormState<FactsResult, FormData>(
    (prev: FactsResult) => readPolicyFactsFor(dealId, prev),
    null,
  );

  const found = result?.ok
    ? FIELDS.map((f) => ({
        ...f,
        fact: (result.facts as Record<string, SuggestedFact | undefined>)[f.key],
      })).filter((f) => f.fact)
    : [];

  return (
    <div className="facts">
      <div className="facts__row">
        <span className="facts__what">From the policy copy</span>
        <form action={submit}>
          <ReadButton />
        </form>
      </div>

      {result && !result.ok ? <p className="facts__bad">{result.message}</p> : null}

      {result?.ok && found.length === 0 ? (
        <p className="facts__bad">
          Nothing could be read from that document — it states none of these fields.
        </p>
      ) : null}

      {found.length > 0 ? (
        <ul className="facts__list">
          {found.map(({ key, label, field, fact }) => (
            <li key={key}>
              <span className="facts__label">{label}</span>
              <span className="facts__value">{fact!.value}</span>
              <span className="facts__where">page {fact!.page}</span>
              {field ? (
                <button
                  type="button"
                  className="linkish"
                  onClick={() => onApply(field, fact!.value)}
                >
                  use
                </button>
              ) : (
                <span className="facts__where">—</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
