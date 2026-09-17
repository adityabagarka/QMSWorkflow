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
  industry: string | null;
  entity_type: string | null;
  cover_start_date: string | null;
  insurer_name: string | null;
  policy_start: string | null;
  sum_insured: number | null;
  expiring_premium: number | null;
  lives: number;
};

/**
 * The frame every step of a deal shares: who the company is, the four figures
 * an RM checks first, where they are in the sequence, and a two-column body.
 *
 * One component rather than a layout repeated per page, so the steps cannot
 * drift apart — the point of a wizard is that only the middle changes.
 *
 * The right column is always reference material for the step: the documents and
 * activity on most, the policy itself on the terms step. Narrower than the main
 * column because it is there to be glanced at, not worked in.
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
}: {
  deal: DealHeader;
  currentPhase: number;
  /** Steps beyond this are not yet reachable. */
  maxReachedPhase: number;
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
  back?: string;
  next?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextNote?: string;
}) {
  const chip = coverStartChip(deal.cover_start_date);

  return (
    <>
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
          <div className="facts__value">{deal.insurer_name ?? '—'}</div>
          {deal.policy_start ? (
            <div className="facts__note">since {formatDate(deal.policy_start)}</div>
          ) : null}
        </div>
        <div className="facts__item">
          <div className="facts__label">Sum insured</div>
          <div className="facts__value">{formatRupees(deal.sum_insured)}</div>
        </div>
        <div className="facts__item">
          <div className="facts__label">Lives</div>
          <div className="facts__value">{deal.lives > 0 ? formatCount(deal.lives) : '—'}</div>
        </div>
        <div className="facts__item">
          <div className="facts__label">Expiring premium</div>
          <div className="facts__value">{formatRupees(deal.expiring_premium)}</div>
          {/* The one place GST is qualified, against the figure it applies to. */}
          <div className="facts__note">{GST_NOTE}</div>
        </div>
      </div>

      {/* Steps are links, so going back to review or edit an earlier one is a
          click rather than a retraced path. Steps ahead of where the deal has
          reached are inert. */}
      <nav className="wiz">
        {STAGES.map((stage) => {
          const reachable = stage.phase <= maxReachedPhase;
          const className =
            stage.phase === currentPhase
              ? 'is-now'
              : stage.phase < currentPhase
                ? 'is-done'
                : undefined;

          const body = (
            <>
              <span className="wiz__n">{stage.phase + 1}</span>
              <span className="wiz__t">{stage.label}</span>
            </>
          );

          return reachable ? (
            <Link key={stage.phase} href={stageHref(deal.id, stage.phase)} className={className}>
              {body}
            </Link>
          ) : (
            <span key={stage.phase} className="wiz__locked">
              {body}
            </span>
          );
        })}
      </nav>

      <div className={aside ? 'step' : 'step step--full'}>
        <div className="step__main">
          <h2>{title}</h2>
          <hr className="section__rule" />
          {children}

          <div className="step-nav">
            {back ? (
              <Link className="button button--secondary" href={back}>
                ← back
              </Link>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {nextNote ? (
                <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{nextNote}</span>
              ) : null}
              {next && !nextDisabled ? (
                <Link className="button" href={next}>
                  {nextLabel} →
                </Link>
              ) : next ? (
                <button className="button" type="button" disabled>
                  {nextLabel} →
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {aside ? <aside className="step__aside">{aside}</aside> : null}
      </div>
    </>
  );
}
