'use client';

import type { FactsResult, SuggestedFact } from './read-policy-facts';

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
 * What the policy copy says, and where each value came from.
 *
 * The values themselves are already in the fields below — applying them and
 * asking somebody to review is one act, and a "use" button between the two was
 * a decision nobody needed to make twice. What survives here is the provenance:
 * which page each value came off, so a figure that looks wrong can be checked
 * against the document in one click rather than argued about.
 *
 * A saved value is never overwritten by this. A schedule can carry an address
 * three renewals old, and the register and a person both beat it (ADR 0011
 * rule 4).
 */
export function PolicyFactsPanel({ result }: { result: FactsResult }) {
  const found = result?.ok
    ? FIELDS.map((f) => ({
        ...f,
        fact: (result.facts as Record<string, SuggestedFact | undefined>)[f.key],
      })).filter((f) => f.fact)
    : [];

  return (
    <div className="facts">
      <div className="facts__row">
        <span className="facts__what">
          {found.length > 0
            ? 'Read from the policy copy — check the fields below'
            : 'From the policy copy'}
        </span>
      </div>

      {result && !result.ok ? <p className="facts__bad">{result.message}</p> : null}

      {result?.ok && found.length === 0 ? (
        <p className="facts__bad">
          Nothing could be read from that document — it states none of these fields.
        </p>
      ) : null}

      {result === null ? <p className="facts__bad">No policy copy uploaded yet.</p> : null}

      {found.length > 0 ? (
        <ul className="facts__list">
          {found.map(({ key, label, fact }) => (
            <li key={key}>
              <span className="facts__label">{label}</span>
              <span className="facts__value">{fact!.value}</span>
              <span className="facts__where">page {fact!.page}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
