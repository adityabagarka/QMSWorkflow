import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { formatDate, formatRupees } from '@/lib/format';

/** Step 2 — the expiring policy: its headline terms and the copy itself. */
export default async function PolicyStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase, policyId } = loaded;
  const supabase = supabaseServer();

  const [{ data: policy }, { data: docs }] = await Promise.all([
    policyId
      ? supabase
          .from('policies')
          .select('insurer_name, policy_start, policy_end, sum_insured, industry, entity_type')
          .eq('id', policyId)
          .maybeSingle<{
            insurer_name: string | null;
            policy_start: string | null;
            policy_end: string | null;
            sum_insured: number | null;
          }>()
      : Promise.resolve({ data: null }),
    supabase
      .from('policy_documents')
      .select('id, file_ref, doc_type, uploaded_at')
      .eq('case_id', header.id)
      .order('uploaded_at', { ascending: false })
      .returns<{ id: string; file_ref: string; doc_type: string; uploaded_at: string }[]>(),
  ]);

  const documents = docs ?? [];

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
        title="Expiring policy"
        back={stageHref(header.id, 0)}
        next={stageHref(header.id, 2)}
        nextLabel="members"
        aside={
          <div className="aside-block">
            <h3>Policy copy</h3>
            {documents.length > 0 ? (
              documents.map((d) => (
                <div className="doc" key={d.id}>
                  <span>{d.file_ref.split('/').pop()}</span>
                  <span className="doc__meta">{d.doc_type}</span>
                </div>
              ))
            ) : (
              <p className="field__hint" style={{ marginBottom: 12 }}>
                Nothing uploaded yet.
              </p>
            )}
            <div className="drop">
              <div className="drop__big">Upload the policy copy</div>
              <p className="field__hint">PDF or scan, up to 50 MB</p>
            </div>
          </div>
        }
      >
        <dl className="detail-list">
          <div>
            <dt>Incumbent insurer</dt>
            <dd>{policy?.insurer_name ?? 'Not captured'}</dd>
          </div>
          <div>
            <dt>Policy started</dt>
            <dd>{formatDate(policy?.policy_start)}</dd>
          </div>
          <div>
            <dt>Sum insured</dt>
            <dd>{formatRupees(policy?.sum_insured)}</dd>
          </div>
        </dl>
        <p className="field__hint" style={{ marginTop: 20 }}>
          These terms are read from the policy copy at the terms step, and confirmed there before
          anything goes to an insurer.
        </p>
      </DealShell>
    </main>
  );
}
