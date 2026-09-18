/**
 * The six steps a deal moves through (ADR 0011, §11, §14 screen 2).
 *
 * Documents first. The wizard is a review pipeline, not a data-entry form: step
 * 1 collects the evidence, steps 2 to 5 each confirm one slice of what was read
 * from it, and step 6 assembles. Nothing in step 1 is mandatory — the documents
 * do not arrive together and a deal must be able to start before they do — but
 * all four are required to dispatch an RFQ at step 6, which is where the
 * obligation actually bites.
 *
 * Labels are presentation; `cases.current_phase` stores the number.
 */
export const STAGES = [
  { phase: 0, label: 'Documents', slug: 'documents' },
  { phase: 1, label: 'Deal setup', slug: '' },
  { phase: 2, label: 'Members', slug: 'members' },
  { phase: 3, label: 'Claims', slug: 'claims' },
  { phase: 4, label: 'Terms & options', slug: 'terms' },
  { phase: 5, label: 'RFQ', slug: 'rfq' },
] as const;

export function stageLabel(phase: number): string {
  return STAGES.find((s) => s.phase === phase)?.label ?? `Stage ${phase}`;
}

export function stageHref(dealId: string, phase: number): string {
  const stage = STAGES.find((s) => s.phase === phase);
  return stage && stage.slug ? `/deals/${dealId}/${stage.slug}` : `/deals/${dealId}`;
}
