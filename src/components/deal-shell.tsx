import Link from 'next/link';
import { CoverStartEdit } from '@/components/cover-start-edit';
import { deriveCoverStart } from '@/lib/cases/cover-start';
import { STAGES, stageHref } from '@/lib/cases/phases';
import {
  coverStartChip,
  describeCompany,
  formatCount,
  formatDate,
  formatRupees,
} from '@/lib/format';

export type DealHeader = {
  id: string;
  policy_expiry_date: string | null;
  cover_start_change_reason: string | null;
  cover_start_change_note: string | null;
  linkedin_url: string | null;
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
  nextForm,
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
  /**
   * The id of a form on this step that the forward button should submit.
   *
   * A step that collects something has no business offering both "save" and
   * "next" — they are the same intention, and asking for two clicks to express
   * it is how a wizard starts feeling like paperwork. The action saves and then
   * sends the user on, so the footer button is the only one on the page.
   */
  nextForm?: string;
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

          <dl className="summary__rows">
            <div>
              <dt>Incumbent insurer</dt>
              <dd>{deal.insurer_name ?? '—'}</dd>
            </div>
            <div>
              <dt>Incumbent broker</dt>
              <dd>{deal.broker_name ?? '—'}</dd>
            </div>
          </dl>
        </div>

        {/*
          The three figures consulted on every screen, set large so they never
          need hunting for. No GST note here: premiums exclude GST throughout,
          which is stated where a figure is entered and once on the comparison,
          not repeated wherever one is displayed.
        */}
        <div className="summary__stats">
          <div className="summary__stat">
            <span className="label">Lives</span>
            <span className="figure">{deal.lives > 0 ? formatCount(deal.lives) : '—'}</span>
            {/* A link, not a number. LinkedIn's headcount is self-reported and
                global, so it is worth a glance beside the roster figure and
                worth nothing as data — putting a band here would give a guess
                the same weight as a count of real people. */}
            {deal.linkedin_url ? (
              <span className="under">
                <a href={deal.linkedin_url} target="_blank" rel="noreferrer noopener">
                  LinkedIn ↗
                </a>
              </span>
            ) : null}
          </div>
          <div className="summary__stat">
            <span className="label">Expiring premium</span>
            <span className="figure">{formatRupees(deal.expiring_premium)}</span>
          </div>
          <div className="summary__stat">
            <span className="label">Cover starts</span>
            {/* Derived from the expiry date, so it is shown rather than asked
                for — and changed here, where the reason is worth capturing. */}
            <CoverStartEdit
              dealId={deal.id}
              coverStart={deal.cover_start_date}
              derived={deriveCoverStart(deal.policy_expiry_date)}
              chip={chip}
              reason={deal.cover_start_change_reason}
              note={deal.cover_start_change_note}
            />
          </div>
        </div>
      </section>

      <nav className="wiz">
        {STAGES.map((s, i) => {
          const reachable = s.phase <= maxReachedPhase;
          const className =
            s.phase === currentPhase ? 'is-now' : s.phase < currentPhase ? 'is-done' : undefined;
          const body = (
            <>
              <span className="wiz__n">{s.phase + 1}</span>
              <span className="wiz__t">{s.label}</span>
            </>
          );

          return (
            <div key={s.phase} className="wiz__step">
              {reachable ? (
                <Link href={stageHref(deal.id, s.phase)} className={className}>
                  {body}
                </Link>
              ) : (
                <span className="wiz__locked">{body}</span>
              )}
              {/* The connector belongs between steps, so the last one has none. */}
              {i < STAGES.length - 1 ? <span className="wiz__link" /> : null}
            </div>
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
          {nextForm && !nextDisabled ? (
            <button className="button" type="submit" form={nextForm}>
              {nextLabel}
            </button>
          ) : next && !nextDisabled ? (
            <Link className="button" href={next}>
              {nextLabel}
            </Link>
          ) : next || nextForm ? (
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
