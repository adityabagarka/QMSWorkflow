import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { appetiteOptions } from '@/lib/cases/appetite';
import { CompanyForm } from './company-form';

/** Step 1 — who we are quoting for. */
export default async function CompanyStep({ params }: { params: { id: string } }) {
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
        'customer_name, gstin, location, entity_type, industry, date_of_incorporation, cover_start_date',
      )
      .eq('id', params.id)
      .single<{
        customer_name: string;
        gstin: string | null;
        location: string | null;
        entity_type: string | null;
        industry: string | null;
        date_of_incorporation: string | null;
        cover_start_date: string | null;
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
      <Masthead meta={session.email} />

      <DealShell
        deal={header}
        currentPhase={0}
        maxReachedPhase={Math.max(currentPhase, 1)}
        title="Company"
        next={stageHref(header.id, 1)}
        nextLabel="expiring policy"
        aside={
          <div className="aside-block">
            <h3>Activity</h3>
            {events && events.length > 0 ? (
              <ul className="timeline">
                {events.map((e, i) => (
                  <li key={i}>
                    {e.event_type.replace(/_/g, ' ')}
                    <span className="timeline__when">
                      {new Date(e.created_at).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ff__hint">Nothing recorded yet.</p>
            )}
          </div>
        }
      >
        <CompanyForm
          dealId={params.id}
          initial={deal}
          industries={industries}
          entityTypes={entityTypes}
        />
      </DealShell>
    </main>
  );
}
