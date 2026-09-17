/**
 * The six stages a deal moves through (§11, §14 screen 2).
 *
 * Labels are presentation and will be reworded; `cases.current_phase` stores
 * the number. `href` is the step's own screen, so the checklist on the deal
 * page and the step navigation inside a stage stay in step with each other.
 */
export const STAGES = [
  { phase: 0, label: 'Company', slug: '' },
  { phase: 1, label: 'Expiring policy', slug: 'policy' },
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
