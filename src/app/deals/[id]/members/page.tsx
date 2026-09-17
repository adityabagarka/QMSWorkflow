import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { StepPlaceholder } from '@/components/step-placeholder';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';

/** Step 3 — the member roster. */
export default async function MembersStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;

  return (
    <main className="shell">
      <Masthead meta={session.email} />
      <DealShell
        deal={header}
        currentPhase={2}
        maxReachedPhase={Math.max(currentPhase, 3)}
        title="Members"
        back={stageHref(header.id, 1)}
        next={stageHref(header.id, 3)}
        nextLabel="claims"
      >
        <StepPlaceholder what="Roster upload, the sanity checks, and the deviations against the expiring policy's terms. The database side is built; the screens are next." />
      </DealShell>
    </main>
  );
}
