import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { StepPlaceholder } from '@/components/step-placeholder';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';

/** Step 6 — assembling and sending the RFQ. */
export default async function RfqStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;

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
        <StepPlaceholder what="Pack assembly, the compliance review gate, and dispatch to insurers." />
      </DealShell>
    </main>
  );
}
