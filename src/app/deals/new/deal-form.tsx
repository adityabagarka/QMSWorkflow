'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useState } from 'react';
import { Field, Input } from '@/components/form';
import { createDeal, findCustomers, type CreateDealResult, type CustomerMatch } from '../actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'creating…' : 'create deal'}
    </button>
  );
}

/**
 * Starting a deal means naming the company it is for — either one we already
 * know, or a new one.
 *
 * The search comes first deliberately. A customer outlives a deal (ADR 0011
 * rule 4), so the second deal against a company should attach to the record we
 * already hold rather than create a near-duplicate with the name typed slightly
 * differently. Showing what we know before offering a blank field is what makes
 * that the easy path rather than the diligent one.
 *
 * Everything else about the company — brand and legal name, GSTIN, industry,
 * constitution — is asked for on the deal setup step, where the uploaded
 * documents can answer most of it. This screen only has to get far enough to
 * have somewhere to put them.
 */
export function DealForm() {
  const [result, submit] = useFormState<CreateDealResult, FormData>(createDeal, null);

  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [picked, setPicked] = useState<CustomerMatch | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (picked || query.trim().length < 2) {
      setMatches([]);
      return;
    }

    // Debounced, and guarded against an earlier search resolving after a later
    // one: typing "Meridian" fires several, and the slowest must not win.
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      findCustomers(query)
        .then((found) => {
          if (live) setMatches(found);
        })
        .finally(() => {
          if (live) setSearching(false);
        });
    }, 200);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, picked]);

  return (
    <form action={submit} style={{ maxWidth: 620 }}>
      {picked ? (
        <div className="picked">
          <input type="hidden" name="customer_id" value={picked.id} />
          <div>
            <div className="picked__name">{picked.legal_name}</div>
            <div className="picked__what">
              {picked.gstin ? `${picked.gstin} · ` : ''}
              {picked.description}
            </div>
          </div>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setPicked(null);
              setQuery('');
            }}
          >
            change
          </button>
        </div>
      ) : (
        <>
          <Field label="Customer" wide>
            <Input
              name="customer_name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              placeholder="Meridian Logistics, or 27AABCM1234N1Z5"
              required
            />
          </Field>

          {matches.length > 0 ? (
            <ul className="matches">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => setPicked(m)}>
                    <span className="matches__name">{m.legal_name}</span>
                    <span className="matches__what">
                      {m.gstin ? `${m.gstin} · ` : ''}
                      {m.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {searching && matches.length === 0 && query.trim().length >= 2 ? (
            <p className="ff__hint">Looking…</p>
          ) : null}
        </>
      )}

      <Field label="Policy expiry date">
        <Input type="date" name="policy_expiry_date" />
      </Field>

      {result && !result.ok ? (
        <p style={{ color: 'var(--plum-red-deep)', fontSize: 14 }}>{result.message}</p>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <SubmitButton />
      </div>
    </form>
  );
}
