import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { STAGES, stageHref } from '@/lib/cases/phases';
import {
  GST_NOTE,
  coverStartChip,
  describeCompany,
  formatCount,
  formatDate,
  formatRupees,
} from '@/lib/format';

type DealDetail = {
  id: string;
  customer_name: string;
  current_phase: number;
  industry: string | null;
  entity_type: string | null;
  cover_start_date: string | null;
  policies: {
    id: string;
    insurer_name: string | null;
    policy_start: string | null;
    sum_insured: number | null;
  }[];
};

/** What each stage says about itself when the deal page is at rest. */
type StageState = { state: string; done: boolean; progress?: number };

export default async function DealPage({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const supabase = supabaseServer();

  // Row-level security decides visibility: a deal outside the caller's span is
  // simply not found, which leaks nothing about whether it exists.
  const { data: deal } = await supabase
    .from('cases')
    .select(
      'id, customer_name, current_phase, industry, entity_type, cover_start_date, policies(id, insurer_name, policy_start, sum_insured)',
    )
    .eq('id', params.id)
    .maybeSingle<DealDetail>();

  if (!deal) notFound();

  const policy = deal.policies?.[0] ?? null;

  const [documents, members, claims, review, options, events] = await Promise.all([
    supabase
      .from('policy_documents')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', deal.id),
    supabase
      .from('member_records')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', deal.id),
    supabase
      .from('claims_uploads')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', deal.id),
    policy
      ? supabase.rpc('policy_review_progress', { p_policy_id: policy.id }).single<{
          decided: number;
          total: number;
        }>()
      : Promise.resolve({ data: null }),
    supabase
      .from('rfq_options')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', deal.id),
    supabase
      .from('case_events')
      .select('event_type, created_at')
      .eq('case_id', deal.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .returns<{ event_type: string; created_at: string }[]>(),
  ]);

  const decided = review?.data?.decided ?? 0;
  const total = review?.data?.total ?? 0;
  const docCount = documents.count ?? 0;
  const memberCount = members.count ?? 0;
  const claimCount = claims.count ?? 0;
  const optionCount = options.count ?? 0;

  const stageStates: Record<number, StageState> = {
    0: { state: describeCompany([deal.entity_type, deal.industry]), done: true },
    1: {
      state: policy
        ? `${policy.insurer_name ?? 'Insurer not set'} · ${docCount} document${docCount === 1 ? '' : 's'}`
        : 'Not started',
      done: Boolean(policy && docCount > 0),
    },
    2: {
      state: memberCount > 0 ? `${formatCount(memberCount)} lives` : 'No roster uploaded',
      done: memberCount > 0,
    },
    3: { state: claimCount > 0 ? `${claimCount} file(s)` : 'No claims data', done: claimCount > 0 },
    4: {
      state:
        total > 0
          ? `${decided} of ${total} confirmed${optionCount > 0 ? ` · ${optionCount} option${optionCount === 1 ? '' : 's'}` : ''}`
          : 'Nothing confirmed yet',
      done: total > 0 && decided === total,
      progress: total > 0 ? decided / total : 0,
    },
    5: {
      state: total > 0 && decided === total ? 'Ready to send' : 'Locked until terms are confirmed',
      done: false,
    },
  };

  const chip = coverStartChip(deal.cover_start_date);

  return (
    <main className="shell">
      <Masthead meta={session.email} />

      <div className="crumb">
        <Link href="/deals">← Deals</Link>
      </div>

      <div className="deal-hero">
        <div>
          <h1>{deal.customer_name}</h1>
          <p className="deal-hero__what">{describeCompany([deal.entity_type, deal.industry])}</p>
        </div>
        <div className="deal-hero__start">
          <div className="label">Cover starts</div>
          <div className="date">{formatDate(deal.cover_start_date)}</div>
          <div style={{ marginTop: 5 }}>
            <span className={chip.className}>{chip.label}</span>
          </div>
        </div>
      </div>

      <div className="facts">
        <div className="facts__item">
          <div className="facts__label">Incumbent</div>
          <div className="facts__value">{policy?.insurer_name ?? '—'}</div>
          {policy?.policy_start ? (
            <div className="facts__note">since {formatDate(policy.policy_start)}</div>
          ) : null}
        </div>
        <div className="facts__item">
          <div className="facts__label">Sum insured</div>
          <div className="facts__value">{formatRupees(policy?.sum_insured)}</div>
        </div>
        <div className="facts__item">
          <div className="facts__label">Lives</div>
          <div className="facts__value">{memberCount > 0 ? formatCount(memberCount) : '—'}</div>
        </div>
        <div className="facts__item">
          <div className="facts__label">Expiring premium</div>
          <div className="facts__value">—</div>
          {/* The single place GST is qualified: against the figure it applies to. */}
          <div className="facts__note">{GST_NOTE}</div>
        </div>
      </div>

      <div className="stages">
        {STAGES.map((stage) => {
          const s = stageStates[stage.phase]!;
          const isNow = stage.phase === deal.current_phase;
          const className = isNow
            ? 'stage stage--now'
            : s.done
              ? 'stage stage--done'
              : 'stage stage--todo';

          return (
            <div key={stage.phase} className={className}>
              <span className="stage__num">{stage.phase + 1}</span>
              <div className="stage__body">
                <div className="stage__title">{stage.label}</div>
                <div className="stage__state">{s.state}</div>
                {s.progress !== undefined && s.progress > 0 ? (
                  <div className="bar">
                    <i style={{ width: `${Math.round(s.progress * 100)}%` }} />
                  </div>
                ) : null}
              </div>
              {isNow ? (
                <Link className="button" href={stageHref(deal.id, stage.phase)}>
                  continue
                </Link>
              ) : s.done ? (
                <Link className="button button--secondary" href={stageHref(deal.id, stage.phase)}>
                  open
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="section">
        <p className="eyebrow">Activity</p>
        {events.data && events.data.length > 0 ? (
          <ul className="timeline">
            {events.data.map((e, i) => (
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
          <p className="empty">Nothing recorded yet.</p>
        )}
      </section>
    </main>
  );
}
