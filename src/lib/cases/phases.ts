/**
 * The five steps a deal moves through (ADR 0011, ADR 0013, §11, §14 screen 2).
 *
 * The first step is the deal: who it is for, the documents it is built from,
 * and the expiring programme those documents describe. Those were three screens
 * — name the customer, upload the files, fill in the setup — and they are one
 * question asked three times, with a round trip between each. Merged, the
 * policy copy lands beside the fields it fills and the facts read out of it
 * appear directly above them.
 *
 * Nothing in step 1 is mandatory beyond a customer. The documents do not arrive
 * together and a deal must be able to start before they do; all four are
 * required to dispatch an RFQ at step 5, which is where the obligation bites.
 *
 * Labels are presentation; `cases.current_phase` stores the number.
 */
export const STAGES = [
  { phase: 0, label: 'Deal', slug: '' },
  { phase: 1, label: 'Members', slug: 'members' },
  { phase: 2, label: 'Claims', slug: 'claims' },
  { phase: 3, label: 'Terms & options', slug: 'terms' },
  { phase: 4, label: 'RFQ', slug: 'rfq' },
] as const;

export function stageLabel(phase: number): string {
  return STAGES.find((s) => s.phase === phase)?.label ?? `Stage ${phase}`;
}

export function stageHref(dealId: string, phase: number): string {
  const stage = STAGES.find((s) => s.phase === phase);
  return stage && stage.slug ? `/deals/${dealId}/${stage.slug}` : `/deals/${dealId}`;
}
