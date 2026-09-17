/**
 * The six phases a case moves through (§11, §14 screen 2).
 *
 * Kept here rather than in the database as an enum because the labels are
 * presentation and will be reworded; `cases.current_phase` stores the number.
 */
export const PHASES = [
  { phase: 0, label: 'Intake' },
  { phase: 1, label: 'Policy review' },
  { phase: 2, label: 'RFQ preparation' },
  { phase: 3, label: 'Insurer responses' },
  { phase: 4, label: 'Quote comparison' },
  { phase: 5, label: 'Customer decision' },
  { phase: 6, label: 'Issuance' },
] as const;

export function phaseLabel(phase: number): string {
  return PHASES.find((p) => p.phase === phase)?.label ?? `Phase ${phase}`;
}
