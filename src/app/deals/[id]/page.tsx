import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { describeCompany, formatDate } from '@/lib/format';

/** Step 1 — the company. What we know, and what is still missing. */
export default async function DealPage({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const { data: events } = await supabase
    .from('case_events')
    .select('event_type, created_at')
    .eq('case_id', header.id)
    .order('created_at', { ascending: false })
    .limit(6)
    .returns<{ event_type: string; created_at: string }[]>();

  const missing = [
    !header.entity_type && 'constitution',
    !header.industry && 'industry',
    !header.cover_start_date && 'cover start date',
  ].filter(Boolean) as string[];

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
        nextNote={missing.length > 0 ? `${missing.join(', ')} not captured` : undefined}
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
              <p className="field__hint">Nothing recorded yet.</p>
            )}
          </div>
        }
      >
        <dl className="detail-list">
          <div>
            <dt>Legal name</dt>
            <dd>{header.customer_name}</dd>
          </div>
          <div>
            <dt>Constitution and industry</dt>
            <dd>{describeCompany([header.entity_type, header.industry])}</dd>
          </div>
          <div>
            <dt>Cover starts</dt>
            <dd>{formatDate(header.cover_start_date)}</dd>
          </div>
        </dl>
      </DealShell>
    </main>
  );
}
