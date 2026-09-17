'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Field, FieldRow, Input, Select } from '@/components/form';
import { looksLikeGstin, lookupGstin, sampleGstins } from '@/lib/cases/gstin';
import { saveCompany, type SaveResult } from './actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'saving…' : 'save'}
    </button>
  );
}

export function CompanyForm({
  dealId,
  initial,
  industries,
  entityTypes,
}: {
  dealId: string;
  initial: {
    customer_name: string;
    gstin: string | null;
    location: string | null;
    entity_type: string | null;
    industry: string | null;
    date_of_incorporation: string | null;
    cover_start_date: string | null;
  };
  industries: string[];
  entityTypes: string[];
}) {
  const [result, submit] = useFormState<SaveResult, FormData>(saveCompany.bind(null, dealId), null);

  const [gstin, setGstin] = useState(initial.gstin ?? '');
  const [name, setName] = useState(initial.customer_name);
  const [location, setLocation] = useState(initial.location ?? '');
  const [entityType, setEntityType] = useState(initial.entity_type ?? '');
  const [doi, setDoi] = useState(initial.date_of_incorporation ?? '');
  const [lookup, setLookup] = useState<'idle' | 'found' | 'missing'>('idle');

  function onFetch() {
    const facts = lookupGstin(gstin);
    if (!facts) {
      setLookup('missing');
      return;
    }
    setName(facts.legalName);
    setLocation(facts.location);
    setEntityType(facts.entityType);
    if (facts.dateOfIncorporation) setDoi(facts.dateOfIncorporation);
    setLookup('found');
  }

  const years = doi
    ? Math.floor((Date.now() - new Date(doi).getTime()) / (365.25 * 86_400_000))
    : null;

  return (
    <form action={submit}>
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
        <Field label="Legal name" wide hint="As it will appear on the policy.">
          <Input
            name="customer_name"
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

      <FieldRow>
        <Field label="Cover starts" hint="Inception of the policy being quoted for.">
          <Input
            type="date"
            name="cover_start_date"
            defaultValue={initial.cover_start_date ?? ''}
          />
        </Field>
      </FieldRow>

      {result && !result.ok ? (
        <p style={{ color: 'var(--plum-red-deep)', fontSize: 13.5 }}>{result.message}</p>
      ) : result?.ok ? (
        <p style={{ color: 'var(--gain-ink)', fontSize: 13.5 }}>Saved.</p>
      ) : null}

      <SaveButton />
    </form>
  );
}
