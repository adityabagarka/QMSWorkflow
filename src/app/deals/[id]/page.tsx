import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { appetiteOptions } from '@/lib/cases/appetite';
import { partyOptions } from '@/lib/cases/parties';
import { StepDocuments } from '@/components/step-documents';
import { applyPolicyFacts } from './apply-policy-facts';
import { formatDateTime } from '@/lib/format';
import { DealSetupForm, DEAL_SETUP_FORM_ID } from './deal-setup-form';

/** Step 1 — who we are quoting for, and what they have today. */
export default async function DealSetupStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  /*
   * Fill the deal from the policy copy before anything is read back, so the
   * form and the summary above it show the same thing. Runs once per document
   * and writes only into empty fields (see `applyPolicyFacts`).
   */
  const readOutcome = await applyPolicyFacts(params.id);

  const [{ industries, entityTypes }, parties, { data: deal }, { data: events }] =
    await Promise.all([
      appetiteOptions(),
      partyOptions(),
      supabase
        .from('cases')
        .select(
          'policy_expiry_date, cover_start_date, cover_start_change_reason, cover_start_change_note, customers(brand_name, legal_name, gstin, location, entity_type, industry, website_url, linkedin_url), policies(insurer_name, broker_name, tpa_name, expiring_premium)',
        )
        .eq('id', params.id)
        .single<{
          policy_expiry_date: string | null;
          cover_start_date: string | null;
          cover_start_change_reason: string | null;
          cover_start_change_note: string | null;
          customers: {
            brand_name: string | null;
            legal_name: string;
            gstin: string | null;
            location: string | null;
            entity_type: string | null;
            industry: string | null;
            website_url: string | null;
            linkedin_url: string | null;
          } | null;
          policies: {
            insurer_name: string | null;
            broker_name: string | null;
            tpa_name: string | null;
            expiring_premium: number | null;
          }[];
        }>(),
      supabase
        .from('case_events')
        .select('event_type, created_at')
        .eq('case_id', params.id)
        .order('created_at', { ascending: false })
        .limit(6)
        .returns<{ event_type: string; created_at: string }[]>(),
    ]);

  if (!deal) notFound();

  return (
    <main className="shell">
      <Masthead user={session} dealTitle={header.customer_name} />

      <DealShell
        deal={header}
        currentPhase={0}
        maxReachedPhase={Math.max(currentPhase, 1)}
        title="Deal"
        back="/deals"
        backLabel="back to deals"
        nextForm={DEAL_SETUP_FORM_ID}
        nextLabel="members"
        aside={
          <>
            {/*
              The documents sit beside the fields they fill, not a step away.
              Uploading the policy copy here is what makes the facts above those
              fields appear — which is the whole reason these screens were
              merged (ADR 0013).
            */}
            <div className="aside-block">
              <h3>Documents</h3>
              <StepDocuments
                dealId={params.id}
                kinds={['policy_copy', 'member_data', 'claims_dump', 'claims_mis']}
              />

              {/* A policy copy that yielded nothing says so here, rather than
                  leaving an empty form looking like a failed upload. */}
              {readOutcome?.note ? (
                <p className="ff__hint" style={{ marginTop: 12 }}>
                  {readOutcome.note}
                </p>
              ) : null}
            </div>

            <div className="aside-block">
              <h3>Activity</h3>
              {events && events.length > 0 ? (
                <ul className="timeline">
                  {events.map((e, i) => (
                    <li key={i}>
                      {e.event_type.replace(/_/g, ' ')}
                      <span className="timeline__when">{formatDateTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ff__hint">Nothing recorded yet.</p>
              )}
            </div>
          </>
        }
      >
        <DealSetupForm
          dealId={params.id}
          initial={{
            brand_name: deal.customers?.brand_name ?? null,
            legal_name: deal.customers?.legal_name ?? '',
            gstin: deal.customers?.gstin ?? null,
            location: deal.customers?.location ?? null,
            entity_type: deal.customers?.entity_type ?? null,
            industry: deal.customers?.industry ?? null,
            website_url: deal.customers?.website_url ?? null,
            linkedin_url: deal.customers?.linkedin_url ?? null,
            policy_expiry_date: deal.policy_expiry_date,
            insurer_name: deal.policies?.[0]?.insurer_name ?? null,
            broker_name: deal.policies?.[0]?.broker_name ?? null,
            tpa_name: deal.policies?.[0]?.tpa_name ?? null,
            expiring_premium: deal.policies?.[0]?.expiring_premium ?? null,
          }}
          industries={industries}
          entityTypes={entityTypes}
          insurers={parties.insurers}
          tpas={parties.tpas}
          brokers={parties.brokers}
        />
      </DealShell>
    </main>
  );
}
