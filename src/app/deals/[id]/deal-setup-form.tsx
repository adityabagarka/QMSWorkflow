'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Field, FieldRow, Input, Select } from '@/components/form';
import { looksLikeGstin, lookupGstin, sampleGstins } from '@/lib/cases/gstin';
import { yearsSince, formatDate, GST_INPUT_HINT } from '@/lib/format';
import { COVER_START_CHANGE_REASONS, deriveCoverStart } from '@/lib/cases/cover-start';
import { saveDealSetup, type SaveResult } from './actions';

/** Shared with the page, so the step footer can submit this form. */
export const DEAL_SETUP_FORM_ID = 'deal-setup';

/**
 * Saving is what "next" means on this step, so there is no save button —
 * the footer's forward button submits this form (see DealShell's nextForm).
 * This only reports that something is in flight.
 */
function Saving() {
  const { pending } = useFormStatus();
  return pending ? <p className="ff__hint">Saving…</p> : null;
}

/**
 * A labelled band grouping fields that belong to the same thing.
 *
 * A label, not a lesson. Somebody filling in an expiring premium knows what an
 * expiring premium is, and a sentence explaining the section to them is text
 * they have to read past every time.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="formsec">
      <h3 className="formsec__title">{title}</h3>
      {children}
    </section>
  );
}

export function DealSetupForm({
  dealId,
  initial,
  industries,
  entityTypes,
}: {
  dealId: string;
  initial: {
    brand_name: string | null;
    legal_name: string;
    gstin: string | null;
    location: string | null;
    entity_type: string | null;
    industry: string | null;
    date_of_incorporation: string | null;
    policy_expiry_date: string | null;
    cover_start_date: string | null;
    cover_start_change_reason: string | null;
    cover_start_change_note: string | null;
    insurer_name: string | null;
    broker_name: string | null;
    expiring_premium: number | null;
  };
  industries: string[];
  entityTypes: string[];
}) {
  const [result, submit] = useFormState<SaveResult, FormData>(
    saveDealSetup.bind(null, dealId),
    null,
  );

  const [gstin, setGstin] = useState(initial.gstin ?? '');
  const [name, setName] = useState(initial.legal_name);
  const [brand, setBrand] = useState(initial.brand_name ?? '');
  const [location, setLocation] = useState(initial.location ?? '');
  const [entityType, setEntityType] = useState(initial.entity_type ?? '');
  const [doi, setDoi] = useState(initial.date_of_incorporation ?? '');
  const [lookup, setLookup] = useState<'idle' | 'found' | 'missing'>('idle');

  const [expiry, setExpiry] = useState(initial.policy_expiry_date ?? '');
  const [coverStart, setCoverStart] = useState(initial.cover_start_date ?? '');
  const [reason, setReason] = useState(initial.cover_start_change_reason ?? '');

  function onFetch() {
    const facts = lookupGstin(gstin);
    if (!facts) {
      setLookup('missing');
      return;
    }
    setName(facts.legalName);
    // Only if nobody has said what we call them yet — a fetch should not
    // overwrite the name the team actually uses with the registry's version.
    if (!brand.trim()) setBrand(facts.legalName);
    setLocation(facts.location);
    setEntityType(facts.entityType);
    if (facts.dateOfIncorporation) setDoi(facts.dateOfIncorporation);
    setLookup('found');
  }

  const years = yearsSince(doi);
  const derived = deriveCoverStart(expiry);

  /*
   * Changing the expiry date moves the derivation with it, and the cover start
   * follows unless it has been deliberately shifted. Without this, correcting a
   * mistyped expiry would leave the old inception behind and silently turn it
   * into an override that needs explaining.
   */
  function onExpiryChange(next: string) {
    const previousDerived = deriveCoverStart(expiry);
    setExpiry(next);

    const wasFollowing = coverStart === '' || coverStart === previousDerived;
    if (wasFollowing) {
      setCoverStart(deriveCoverStart(next) ?? '');
      setReason('');
    }
  }

  const shifted = Boolean(coverStart && derived && coverStart !== derived);

  return (
    <form action={submit} id={DEAL_SETUP_FORM_ID}>
      <Section title="Company">
        <FieldRow>
          <Field
            label="GSTIN"
            hint={
              lookup === 'missing'
                ? 'No taxpayer record for that GSTIN. Enter the details by hand below.'
                : lookup === 'found'
                  ? 'Legal name, place of business and constitution read from the GSTN record.'
                  : `15 characters. Try ${sampleGstins()[0]}`
            }
          >
            <Input
              name="gstin"
              value={gstin}
              onChange={(e) => {
                setGstin(e.target.value.toUpperCase());
                setLookup('idle');
              }}
              placeholder="27AABCM1234N1Z5"
              autoComplete="off"
            />
          </Field>

          <Field label="&nbsp;">
            <button
              className="button button--secondary"
              type="button"
              onClick={onFetch}
              disabled={!looksLikeGstin(gstin)}
              style={{ height: 42 }}
            >
              fetch details
            </button>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Name" hint="What we call them.">
            <Input name="brand_name" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Legal name" hint="As it appears on the policy.">
            <Input
              name="legal_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Principal place of business">
            <Input name="location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Constitution">
            <Select
              name="entity_type"
              options={entityTypes}
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Industry">
            <Select name="industry" options={industries} defaultValue={initial.industry ?? ''} />
          </Field>
          <Field
            label="Date of incorporation"
            hint={years !== null && years >= 0 ? `${years} years old` : undefined}
          >
            <Input
              type="date"
              name="date_of_incorporation"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Expiring programme">
        <FieldRow>
          <Field label="Incumbent insurer">
            <Input name="insurer_name" defaultValue={initial.insurer_name ?? ''} />
          </Field>
          <Field label="Incumbent broker">
            <Input name="broker_name" defaultValue={initial.broker_name ?? ''} />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Expiring premium" hint={GST_INPUT_HINT}>
            <Input
              type="number"
              name="expiring_premium"
              defaultValue={initial.expiring_premium ?? ''}
              min="0"
              step="1"
            />
          </Field>
          <Field label="Policy expires">
            <Input
              type="date"
              name="policy_expiry_date"
              value={expiry}
              onChange={(e) => onExpiryChange(e.target.value)}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field
            label="Cover starts"
            hint={derived ? `The day after the policy expires: ${formatDate(derived)}` : undefined}
          >
            <Input
              type="date"
              name="cover_start_date"
              value={coverStart}
              onChange={(e) => setCoverStart(e.target.value)}
            />
          </Field>
        </FieldRow>

        {/*
          Only once the date has actually been moved. Asking why on every deal
          would make the answer noise; asking only when something happened keeps
          it worth reading — and worth counting across deals, which is the point
          of a vocabulary rather than a note.
        */}
        {shifted ? (
          <div className="shiftnote">
            <FieldRow>
              <Field label="Why is it not starting the day after expiry?" wide>
                <Select
                  name="cover_start_change_reason"
                  options={Object.entries(COVER_START_CHANGE_REASONS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </Field>
            </FieldRow>

            {reason === 'other' ? (
              <FieldRow>
                <Field label="What happened?" wide>
                  <Input
                    name="cover_start_change_note"
                    defaultValue={initial.cover_start_change_note ?? ''}
                    required
                  />
                </Field>
              </FieldRow>
            ) : null}
          </div>
        ) : null}
      </Section>

      {result && !result.ok ? (
        <p style={{ color: 'var(--plum-red-deep)', fontSize: 13.5 }}>{result.message}</p>
      ) : result?.ok ? (
        <p style={{ color: 'var(--gain-ink)', fontSize: 13.5 }}>Saved.</p>
      ) : null}

      <Saving />
    </form>
  );
}
