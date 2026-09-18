import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { REQUIRED_DOCUMENTS, type CaseDocument } from '@/lib/cases/documents';
import { DocumentSlot } from './document-panel';

/**
 * Step 1 — the evidence the rest of the deal is built from (ADR 0011).
 *
 * Nothing here is mandatory. The documents do not arrive together, so this step
 * accepts whatever exists and always lets the user continue; all four are
 * required at step 6, where an insurer actually needs them.
 */
export default async function DocumentsStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const { data } = await supabase
    .from('case_documents')
    .select('id, kind, file_name, byte_size, read_state, read_error, uploaded_at')
    .eq('case_id', params.id)
    .order('uploaded_at', { ascending: false })
    .returns<CaseDocument[]>();

  const documents = data ?? [];
  const byKind = new Map(documents.map((d) => [d.kind, d]));
  const missing = REQUIRED_DOCUMENTS.filter((s) => !byKind.has(s.kind));

  return (
    <main className="shell">
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />

      <DealShell
        deal={header}
        currentPhase={0}
        maxReachedPhase={Math.max(currentPhase, 1)}
        title="Documents"
        next={stageHref(header.id, 1)}
        nextLabel="deal setup"
        aside={
          <div className="aside-block">
            <h3>Still to come</h3>
            {missing.length === 0 ? (
              <p className="ff__hint">
                All four are held. The RFQ can be sent once the terms are confirmed.
              </p>
            ) : (
              <ul className="plainlist">
                {missing.map((s) => (
                  <li key={s.kind}>{s.label}</li>
                ))}
              </ul>
            )}
          </div>
        }
      >
        <div className="docslots">
          {REQUIRED_DOCUMENTS.map((spec) => (
            <DocumentSlot
              key={spec.kind}
              dealId={params.id}
              spec={spec}
              document={byKind.get(spec.kind) ?? null}
            />
          ))}
        </div>
      </DealShell>
    </main>
  );
}
