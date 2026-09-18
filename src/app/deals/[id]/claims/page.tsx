import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { formatCount } from '@/lib/format';
import { previewClaims } from './actions';
import { ClaimsReview, METRIC_LABELS, formatMetric } from './claims-review';
import { ReconcileRow, type Reconciliation } from './reconcile';

/** Step 4 — what the history says, and which account of it we are quoting on. */
export default async function ClaimsStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const [{ count: claimCount }, { data: recon }, { data: figures }] = await Promise.all([
    supabase
      .from('claim_records')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', params.id),
    supabase
      .from('claims_reconciliations')
      .select('metric, stated_value, computed_value, chosen, chosen_value, note, decided_at')
      .eq('case_id', params.id)
      .order('metric')
      .returns<Reconciliation[]>(),
    supabase
      .from('claims_stated_figures')
      .select('metric, value')
      .eq('case_id', params.id)
      .returns<{ metric: string; value: number }[]>(),
  ]);

  const isLoaded = (claimCount ?? 0) > 0;
  const preview = isLoaded ? null : await previewClaims(params.id);

  const reconciliations = recon ?? [];
  const outstanding = reconciliations.filter((r) => !r.chosen);

  return (
    <main className="shell">
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />
      <DealShell
        deal={header}
        currentPhase={3}
        maxReachedPhase={Math.max(currentPhase, 4)}
        title="Claims"
        back={stageHref(header.id, 2)}
        next={stageHref(header.id, 4)}
        nextLabel="terms"
        nextNote={outstanding.length > 0 ? `${outstanding.length} still to decide` : undefined}
      >
        {isLoaded ? (
          <div>
            <p className="standfirst">
              {formatCount(claimCount ?? 0)} claims held
              {figures && figures.length > 0
                ? `, alongside ${figures.length} figures the insurer states`
                : ''}
              .
            </p>

            {reconciliations.length === 0 ? (
              <div className="notice" style={{ marginTop: 20 }}>
                <p style={{ margin: 0 }}>
                  {figures && figures.length > 0
                    ? 'The dump and the MIS agree on every figure they both cover.'
                    : 'No MIS to read against the dump, so there is nothing to reconcile.'}
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ marginTop: 28 }}>
                  {outstanding.length > 0 ? 'Figures that disagree' : 'Figures that disagreed'}
                </h3>
                <p className="ff__hint" style={{ maxWidth: '64ch' }}>
                  {outstanding.length > 0
                    ? 'The RFQ cannot be built until each of these has a figure chosen. A gap here is usually worth raising with the insurer.'
                    : 'All settled. What was chosen, and why, is on the record.'}
                </p>

                <div className="recons">
                  {reconciliations.map((row) => (
                    <ReconcileRow key={row.metric} dealId={params.id} row={row} />
                  ))}
                </div>
              </>
            )}

            {figures && figures.length > 0 ? (
              <>
                <h3 style={{ marginTop: 32 }}>What the insurer states</h3>
                <table className="bandtable">
                  <tbody>
                    {figures.map((f) => (
                      <tr key={f.metric}>
                        <td>{METRIC_LABELS[f.metric] ?? f.metric}</td>
                        <td>{formatMetric(f.metric, f.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            <p style={{ marginTop: 28 }}>
              <Link href={stageHref(header.id, 0)}>Upload a corrected dump</Link> to replace this.
            </p>
          </div>
        ) : preview?.ok ? (
          <ClaimsReview dealId={params.id} preview={preview} />
        ) : (
          <div className="notice">
            <p style={{ margin: 0 }}>
              {preview?.message ?? 'No claims dump has been uploaded yet.'}
            </p>
            <p style={{ margin: '10px 0 0' }}>
              <Link href={stageHref(header.id, 0)}>Go to documents</Link> to add it.
            </p>
          </div>
        )}
      </DealShell>
    </main>
  );
}
