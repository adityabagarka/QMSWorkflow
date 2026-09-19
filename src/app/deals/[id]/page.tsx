import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { appetiteOptions } from '@/lib/cases/appetite';
import { formatDateTime } from '@/lib/format';
import { DealSetupForm, DEAL_SETUP_FORM_ID } from './deal-setup-form';

/** Step 1 — who we are quoting for, and what they have today. */
export default async function DealSetupStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const [{ industries, entityTypes }, { data: deal }, { data: events }] = await Promise.all([
    appetiteOptions(),
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
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />

      <DealShell
        deal={header}
        currentPhase={1}
        maxReachedPhase={Math.max(currentPhase, 2)}
        title="Deal setup"
        back={stageHref(header.id, 0)}
        nextForm={DEAL_SETUP_FORM_ID}
        nextLabel="members"
        aside={
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
        />
      </DealShell>
    </main>
  );
}
