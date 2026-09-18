import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { formatCount, formatDate, formatRupees, GST_INPUT_HINT } from '@/lib/format';
import { assembleRfq, rfqBlockers, BLOCKER_LABELS, BLOCKER_STEP } from '@/lib/rfq/assemble';

/** Step 6 — what goes to the insurers, and whether it can. */
export default async function RfqStep({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { option?: string };
}) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const [blockers, rfq, { data: options }] = await Promise.all([
    rfqBlockers(params.id),
    assembleRfq(params.id, searchParams.option),
    supabase
      .from('rfq_options')
      .select('id, option_no, name')
      .eq('case_id', params.id)
      .order('option_no')
      .returns<{ id: string; option_no: number; name: string }[]>(),
  ]);

  const ready = blockers.length === 0;
  const downloadHref = `/deals/${params.id}/rfq/download${
    searchParams.option ? `?option=${searchParams.option}` : ''
  }`;

  return (
    <main className="shell">
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />
      <DealShell
        deal={header}
        currentPhase={5}
        maxReachedPhase={Math.max(currentPhase, 5)}
        title="RFQ"
        back={stageHref(header.id, 4)}
      >
        {blockers.length > 0 ? (
          <>
            <h3>Not ready yet</h3>
            <p className="ff__hint" style={{ maxWidth: '62ch' }}>
              An insurer cannot quote a programme with pieces missing, so these hold the RFQ.
            </p>
            <ul className="blockers">
              {blockers.map((b) => (
                <li key={b}>
                  <span>{BLOCKER_LABELS[b] ?? b}</span>
                  <Link href={stageHref(header.id, BLOCKER_STEP[b] ?? 0)}>go there</Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="notice" style={{ borderColor: 'var(--gain-line)' }}>
            <p style={{ margin: 0 }}>Everything is in place. The RFQ can go out.</p>
          </div>
        )}

        {rfq ? (
          <>
            {options && options.length > 1 ? (
              <>
                <h3 style={{ marginTop: 32 }}>Which option</h3>
                <p className="ff__hint" style={{ maxWidth: '62ch' }}>
                  Insurers quote against one set of terms. The others stay on the comparison.
                </p>
                <div className="optpick">
                  {options.map((o) => {
                    const picked = rfq.option?.id === o.id;
                    return (
                      <Link
                        key={o.id}
                        href={`${stageHref(header.id, 5)}?option=${o.id}`}
                        className={picked ? 'optpick__one is-picked' : 'optpick__one'}
                      >
                        <span className="optpick__no">Option {o.option_no}</span>
                        <span className="optpick__name">{o.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </>
            ) : null}

            <h3 style={{ marginTop: 32 }}>What the insurers will see</h3>

            <dl className="detail-list">
              <div>
                <dt>Company</dt>
                <dd>
                  {rfq.customer.brandName}
                  {rfq.customer.legalName !== rfq.customer.brandName ? (
                    <div className="cell-muted" style={{ fontSize: 13 }}>
                      Issued to {rfq.customer.legalName}
                    </div>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>Cover starts</dt>
                <dd>{formatDate(rfq.cover.startsOn)}</dd>
              </div>
              <div>
                <dt>Lives</dt>
                <dd>{formatCount(rfq.demography.lives)}</dd>
              </div>
              <div>
                <dt>Expiring premium</dt>
                <dd>
                  {formatRupees(rfq.cover.expiringPremium)}
                  <div className="cell-muted" style={{ fontSize: 13 }}>
                    {GST_INPUT_HINT}
                  </div>
                </dd>
              </div>
              <div>
                <dt>Terms</dt>
                <dd>
                  {formatCount(rfq.terms.length)} benefits,{' '}
                  {formatCount(rfq.terms.filter((t) => t.changed).length)} changed from expiring
                </dd>
              </div>
              <div>
                <dt>Claims history</dt>
                <dd>
                  {rfq.claims.length === 0
                    ? 'None loaded'
                    : `${formatCount(rfq.claims.length)} figures${
                        rfq.claims.some((c) => c.source === 'chosen')
                          ? ', including ones reconciled against the MIS'
                          : ''
                      }`}
                </dd>
              </div>
              {rfq.deviations.length > 0 ? (
                <div>
                  <dt>Member exceptions</dt>
                  <dd>
                    {formatCount(rfq.deviations.reduce((n, d) => n + d.count, 0))} lives flagged
                    {rfq.deviations.some((d) => d.isContinuation) ? ', as continuations' : ''}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div style={{ marginTop: 28, display: 'flex', gap: 14, alignItems: 'center' }}>
              <a className="button button--secondary" href={downloadHref}>
                download the spreadsheet
              </a>
              <span className="ff__hint">
                The file insurers quote from, and issue the policy from.
              </span>
            </div>
          </>
        ) : null}
      </DealShell>
    </main>
  );
}
