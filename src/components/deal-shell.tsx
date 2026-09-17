import Link from 'next/link';
import { STAGES, stageHref } from '@/lib/cases/phases';
import {
  GST_NOTE,
  coverStartChip,
  describeCompany,
  formatCount,
  formatDate,
  formatRupees,
} from '@/lib/format';

export type DealHeader = {
  id: string;
  customer_name: string;
  deal_type: string;
  industry: string | null;
  entity_type: string | null;
  location: string | null;
  cover_start_date: string | null;
  insurer_name: string | null;
  broker_name: string | null;
  policy_start: string | null;
  expiring_premium: number | null;
  lives: number;
};

/**
 * The frame every step of a deal shares.
 *
 * One component rather than a layout repeated per page: the point of a wizard
 * is that only the middle changes, and when the chrome is written per step it
 * drifts — which is how the footer buttons ended up in a different place
 * depending on which step you were on.
 */
export function DealShell({
  deal,
  currentPhase,
  maxReachedPhase,
  title,
  children,
  aside,
  back,
  next,
  nextLabel = 'next',
  nextDisabled = false,
  nextNote,
  wideAside = false,
}: {
  deal: DealHeader;
  currentPhase: number;
  maxReachedPhase: number;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  back?: string;
  next?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextNote?: string;
  wideAside?: boolean;
}) {
  const chip = coverStartChip(deal.cover_start_date);
  const stage = STAGES.find((s) => s.phase === currentPhase);

  return (
    <>
      <div className="crumb">
        <Link href="/deals">← Deals</Link>
      </div>

      {/* Everything identifying about the deal, in one block above the steps. */}
      <section
        className={
          deal.deal_type === 'renewal' ? 'summary summary--renewal' : 'summary summary--rollover'
        }
      >
        <div>
          <h1 className="summary__name">{deal.customer_name}</h1>
          <p className="summary__what">
            {describeCompany([deal.entity_type, deal.industry, deal.location])}
          </p>
          <div className="summary__start">
            <span className="label">Cover starts</span>
            <span className="date">{formatDate(deal.cover_start_date)}</span>
            <span className={chip.className}>{chip.label}</span>
          </div>
        </div>

        <dl className="summary__rows">
          <div>
            <dt>Incumbent insurer</dt>
            <dd>{deal.insurer_name ?? '—'}</dd>
          </div>
          <div>
            <dt>Incumbent broker</dt>
            <dd>{deal.broker_name ?? '—'}</dd>
          </div>
          <div>
            <dt>Lives</dt>
            <dd>{deal.lives > 0 ? formatCount(deal.lives) : '—'}</dd>
          </div>
          <div>
            <dt>Expiring premium</dt>
            <dd>
              {formatRupees(deal.expiring_premium)}
              {/* The one place GST is qualified, against the figure it applies to. */}
              <span className="summary__gst">{GST_NOTE}</span>
            </dd>
          </div>
        </dl>
      </section>

      <nav className="wiz">
        {STAGES.map((s) => {
          const reachable = s.phase <= maxReachedPhase;
          const className =
            s.phase === currentPhase ? 'is-now' : s.phase < currentPhase ? 'is-done' : undefined;
          const body = (
            <>
              <span className="wiz__n">{s.phase + 1}</span>
              <span className="wiz__t">{s.label}</span>
            </>
          );

          return reachable ? (
            <Link key={s.phase} href={stageHref(deal.id, s.phase)} className={className}>
              {body}
            </Link>
          ) : (
            <span key={s.phase} className="wiz__locked">
              {body}
            </span>
          );
        })}
      </nav>

      <div className={aside ? (wideAside ? 'step step--wide-aside' : 'step') : 'step step--full'}>
        <div className="step__main">
          <h2>{title}</h2>
          <hr className="section__rule" />
          {children}
        </div>
        {aside ? <aside className="step__aside">{aside}</aside> : null}
      </div>

      {/* One footer, every step: back hard left, forward hard right. */}
      <div className="stepfoot">
        {back ? (
          <Link className="button button--secondary" href={back}>
            back
          </Link>
        ) : (
          <span />
        )}

        <span className="stepfoot__mid">
          Step {currentPhase + 1} of {STAGES.length}
          {stage ? ` · ${stage.label}` : ''}
        </span>

        <span className="stepfoot__right">
          {nextNote ? (
            <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{nextNote}</span>
          ) : null}
          {next && !nextDisabled ? (
            <Link className="button" href={next}>
              {nextLabel}
            </Link>
          ) : next ? (
            <button className="button" type="button" disabled>
              {nextLabel}
            </button>
          ) : (
            <span />
          )}
        </span>
      </div>
    </>
  );
}
