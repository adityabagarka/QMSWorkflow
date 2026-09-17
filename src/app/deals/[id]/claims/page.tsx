import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { StepPlaceholder } from '@/components/step-placeholder';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';

/** Step 4 — claims history, which drives the indicative pricing. */
export default async function ClaimsStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;

  return (
    <main className="shell">
      <Masthead meta={session.email} />
      <DealShell
        deal={header}
        currentPhase={3}
        maxReachedPhase={Math.max(currentPhase, 4)}
        title="Claims"
        back={stageHref(header.id, 2)}
        next={stageHref(header.id, 4)}
        nextLabel="terms"
      >
        <StepPlaceholder what="Claims history upload and the burn calculation it feeds." />
      </DealShell>
    </main>
  );
}
