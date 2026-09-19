'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Field, FieldRow, Input, Select, Typeahead } from '@/components/form';
import { looksLikeGstin, lookupGstin } from '@/lib/cases/gstin';
import { searchCities } from '@/lib/cases/cities';
import type { Party } from '@/lib/cases/parties';
import { constitutionFromLegalName } from '@/lib/cases/constitution';
import { GST_INPUT_HINT } from '@/lib/format';
import { saveDealSetup, type SaveResult } from './actions';
import { PolicyFactsPanel } from './policy-facts-panel';
import type { FactsResult } from './read-policy-facts';

/** Shared with the page, so the step footer can submit this form. */
export const DEAL_SETUP_FORM_ID = 'deal-setup';

function Saving() {
  const { pending } = useFormStatus();
  return pending ? <p className="ff__hint">Saving…</p> : null;
}

/**
 * A section that can be folded away.
 *
 * The two halves of this step are not equal. A company is a once-a-year fact —
 * looked at on the first deal and reviewed occasionally after — while the deal
 * is what every RFQ turns on. Showing both open, one after another, made a long
 * form out of a short one and buried the part that changes.
 */
function Section({
  title,
  summary,
  defaultOpen,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={open ? 'formsec formsec--open' : 'formsec'}>
      <button
        className="formsec__toggle"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="formsec__caret">{open ? '▾' : '▸'}</span>
        <span className="formsec__title">{title}</span>
        {!open && summary ? <span className="formsec__summary">{summary}</span> : null}
      </button>

      {open ? <div className="formsec__body">{children}</div> : null}
    </section>
  );
}

export function DealSetupForm({
  dealId,
  initial,
  industries,
  entityTypes,
  insurers,
  tpas,
  brokers,
  policyFacts,
}: {
  dealId: string;
  initial: {
    brand_name: string | null;
    legal_name: string;
    gstin: string | null;
    location: string | null;
    entity_type: string | null;
    industry: string | null;
    website_url: string | null;
    linkedin_url: string | null;
    policy_expiry_date: string | null;
    insurer_name: string | null;
    broker_name: string | null;
    tpa_name: string | null;
    expiring_premium: number | null;
  };
  industries: string[];
  entityTypes: string[];
  insurers: Party[];
  tpas: Party[];
  brokers: Party[];
  policyFacts: FactsResult;
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
  const [lookup, setLookup] = useState<'idle' | 'found' | 'missing'>('idle');
  const [broker, setBroker] = useState(initial.broker_name ?? '');
  const [insurer, setInsurer] = useState(initial.insurer_name ?? '');
  const [tpa, setTpa] = useState(initial.tpa_name ?? '');
  const [expiry, setExpiry] = useState(initial.policy_expiry_date ?? '');
  const [premium, setPremium] = useState(
    initial.expiring_premium === null ? '' : String(initial.expiring_premium),
  );

  /*
   * A value read off the policy copy, put into the field it belongs to. Never
   * applied on its own: the schedule is one source among several and the
   * register beats it, so a person decides (ADR 0011 rule 4).
   */
  function applyFact(field: string, value: string) {
    if (field === 'legal_name') onLegalName(value);
    if (field === 'gstin') setGstin(value.toUpperCase());
    if (field === 'insurer_name') setInsurer(value);
    if (field === 'broker_name') setBroker(value);
    if (field === 'tpa_name') setTpa(value);
    if (field === 'policy_expiry_date') setExpiry(value);
    if (field === 'expiring_premium') setPremium(value);
    setShowCompany(true);
  }

  /*
   * The company details stay hidden until there is something to show: a GSTIN
   * that resolved, or a deliberate choice to enter them by hand. A registry
   * lookup answers four of these fields at once, so offering the blank form
   * first makes typing the easy path and verification the diligent one.
   *
   * Already open where the record has a name — an existing customer is being
   * reviewed, not created.
   */
  const known = Boolean(initial.gstin || initial.location || initial.entity_type);
  const [showCompany, setShowCompany] = useState(known);

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
    setLookup('found');
    setShowCompany(true);
  }

  /*
   * An Indian company's legal name carries its form — the Companies Act
   * requires the suffix — so a user who has typed "… Private Limited" has
   * already answered the constitution. Only where the name implies one, and
   * never over an answer somebody gave: the field stays theirs to correct.
   */
  function onLegalName(next: string) {
    setName(next);
    const implied = constitutionFromLegalName(next);
    if (implied && !entityType) setEntityType(implied);
  }

  return (
    <form action={submit} id={DEAL_SETUP_FORM_ID}>
      <PolicyFactsPanel result={policyFacts} onApply={applyFact} />

      <Section
        title="Company"
        defaultOpen={!known}
        summary={[initial.brand_name ?? initial.legal_name, initial.location]
          .filter(Boolean)
          .join(' · ')}
      >
        <FieldRow>
          <Field label="GSTIN">
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

        {lookup === 'missing' ? (
          <p className="ff__hint">No taxpayer record for that GSTIN.</p>
        ) : null}

        {showCompany ? (
          <>
            <FieldRow>
              <Field label="Name" wide>
                <Input name="brand_name" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Legal name">
                <Input
                  name="legal_name"
                  value={name}
                  onChange={(e) => onLegalName(e.target.value)}
                  required
                />
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

            {/* Industry then location, in the order the summary above reads. */}
            <FieldRow>
              <Field label="Industry">
                <Select
                  name="industry"
                  options={industries}
                  defaultValue={initial.industry ?? ''}
                />
              </Field>
              <Field label="Location">
                <Typeahead
                  name="location"
                  value={location}
                  onChange={setLocation}
                  search={searchCities}
                  placeholder="Start typing a city"
                />
              </Field>
            </FieldRow>

            <FieldRow>
              <Field label="Website">
                <Input
                  type="url"
                  name="website_url"
                  defaultValue={initial.website_url ?? ''}
                  placeholder="https://"
                />
              </Field>
              <Field label="LinkedIn">
                <Input
                  type="url"
                  name="linkedin_url"
                  defaultValue={initial.linkedin_url ?? ''}
                  placeholder="https://linkedin.com/company/"
                />
              </Field>
            </FieldRow>
          </>
        ) : (
          <p className="ff__hint">
            <button className="linkish" type="button" onClick={() => setShowCompany(true)}>
              Enter the details by hand
            </button>
          </p>
        )}
      </Section>

      <Section title="Expiring programme" defaultOpen>
        <FieldRow>
          {/* Closed lists: there are about thirty insurers and twenty TPAs, and
              naming one outside them is a mistake rather than a gap. */}
          <Field label="Incumbent insurer">
            <Select
              name="insurer_name"
              options={insurers.map((i) => i.short_name)}
              value={insurer}
              onChange={(e) => setInsurer(e.target.value)}
            />
          </Field>
          {/* Open: several hundred brokers exist and we meet perhaps fifty, so
              the suggestions are the ones we have seen and anything else is
              recorded on the spot rather than refused. */}
          <Field label="Incumbent broker">
            <Typeahead
              name="broker_name"
              value={broker}
              onChange={setBroker}
              search={(q) => {
                const needle = q.trim().toLowerCase();
                if (needle.length < 2) return [];
                return brokers
                  .filter(
                    (b) =>
                      b.short_name.toLowerCase().includes(needle) ||
                      b.legal_name.toLowerCase().includes(needle),
                  )
                  .map((b) => b.short_name)
                  .slice(0, 8);
              }}
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="TPA">
            <Select
              name="tpa_name"
              options={tpas.map((t) => t.short_name)}
              value={tpa}
              onChange={(e) => setTpa(e.target.value)}
            />
          </Field>
          <Field label="Expiring premium" hint={GST_INPUT_HINT}>
            <Input
              type="number"
              name="expiring_premium"
              value={premium}
              onChange={(e) => setPremium(e.target.value)}
              min="0"
              step="1"
            />
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Policy expires">
            <Input
              type="date"
              name="policy_expiry_date"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
            />
          </Field>
        </FieldRow>
      </Section>

      {result && !result.ok ? (
        <p style={{ color: 'var(--plum-red-deep)', fontSize: 13.5 }}>{result.message}</p>
      ) : null}

      <Saving />
    </form>
  );
}
