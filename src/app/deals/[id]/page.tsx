import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { PHASES, phaseLabel } from '@/lib/cases/phases';
import { appetiteGuidance, type AppetiteSignal } from '@/lib/cases/appetite';

type DealDetail = {
  id: string;
  customer_name: string;
  current_phase: number;
  state: string;
  industry: string | null;
  entity_type: string | null;
  policy_expiry_date: string | null;
  created_at: string;
  app_users: { name: string; email: string } | null;
};

/**
 * Appetite shown as expectation, never as a verdict.
 *
 * The wording matters: "usually decline" describes a pattern in the reference
 * data, not a decision. The decision comes from the insurer, by email, and is
 * recorded when it arrives.
 */
function AppetiteNote({ label, signal }: { label: string; signal: AppetiteSignal | null }) {
  if (!signal) return null;

  const { decliningInsurers, totalInsurers } = signal;

  if (decliningInsurers.length === 0) {
    return <p className="field__hint">{label}: no insurer on the panel usually declines this.</p>;
  }

  return (
    <p className="field__hint">
      {label}:{' '}
      <strong>
        {decliningInsurers.length} of {totalInsurers}
      </strong>{' '}
      insurers usually decline — {decliningInsurers.join(', ')}. They are still sent the RFQ; their
      answer is recorded when it comes back.
    </p>
  );
}

export default async function DealPage({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const supabase = supabaseServer();

  // RLS decides visibility. A deal outside the caller's span simply is not
  // found — which is the right answer, and leaks nothing about its existence.
  const { data: deal } = await supabase
    .from('cases')
    .select(
      'id, customer_name, current_phase, state, industry, entity_type, policy_expiry_date, created_at, app_users!cases_owner_user_id_fkey(name, email)',
    )
    .eq('id', params.id)
    .maybeSingle<DealDetail>();

  if (!deal) notFound();

  const [guidance, { data: events }] = await Promise.all([
    appetiteGuidance(deal.industry, deal.entity_type),
    supabase
      .from('case_events')
      .select('id, event_type, created_at')
      .eq('case_id', deal.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .returns<{ id: string; event_type: string; created_at: string }[]>(),
  ]);

  return (
    <main className="shell">
      <Masthead meta={session.email} />

      <section className="section">
        <p className="eyebrow">Rollover deal</p>
        <h1>{deal.customer_name}</h1>
        <hr className="section__rule" />

        <div className="phase-track">
          {PHASES.map((p) => (
            <div
              key={p.phase}
              className={
                p.phase < deal.current_phase
                  ? 'phase-track__step phase-track__step--done'
                  : p.phase === deal.current_phase
                    ? 'phase-track__step phase-track__step--current'
                    : 'phase-track__step'
              }
            >
              <span className="phase-track__number">{p.phase}</span>
              <span className="phase-track__label">{p.label}</span>
            </div>
          ))}
        </div>

        <dl className="detail-grid">
          <div>
            <dt>Phase</dt>
            <dd>{phaseLabel(deal.current_phase)}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{deal.app_users?.name ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Policy expiry</dt>
            <dd>
              {deal.policy_expiry_date
                ? new Date(deal.policy_expiry_date).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })
                : 'Not set'}
            </dd>
          </div>
          <div>
            <dt>Industry</dt>
            <dd>{deal.industry ?? 'Not known yet'}</dd>
          </div>
          <div>
            <dt>Constitution</dt>
            <dd>{deal.entity_type ?? 'Not known yet'}</dd>
          </div>
        </dl>

        {guidance.industry || guidance.entityType ? (
          <div className="notice" style={{ marginTop: 28 }}>
            <p className="eyebrow">What to expect</p>
            <AppetiteNote label="Industry" signal={guidance.industry} />
            <AppetiteNote label="Constitution" signal={guidance.entityType} />
          </div>
        ) : null}
      </section>

      <section className="section">
        <p className="eyebrow">Next</p>
        <h2>Bring in the expiring programme.</h2>
        <hr className="section__rule" />
        <p className="standfirst">
          A rollover is quoted against what the customer already has. The policy copy sets the
          terms, the roster is the population being quoted for, and the claims history drives the
          indicative pricing.
        </p>
        <p className="field__hint" style={{ marginTop: 16 }}>
          Upload screens arrive with the next milestone.
        </p>
      </section>

      <section className="section">
        <p className="eyebrow">Timeline</p>
        <hr className="section__rule" />
        {events && events.length > 0 ? (
          <ul className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                <span className="timeline__when">
                  {new Date(e.created_at).toLocaleString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <span className="timeline__what">{e.event_type.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Nothing recorded yet.</p>
        )}

        <p style={{ marginTop: 32 }}>
          <Link href="/deals">Back to deals</Link>
        </p>
      </section>
    </main>
  );
}
