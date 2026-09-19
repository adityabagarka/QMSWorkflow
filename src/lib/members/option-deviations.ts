import type { GoverningTerms } from '@/lib/members/deviations';

/**
 * The terms an RFQ option actually asks for.
 *
 * An option stores only what it CHANGES (migration 0021) — absence means "same
 * as expiring". So the governing terms for an option are the expiring policy's
 * terms with the option's overrides laid on top, and that merge has to happen
 * before the roster is checked: an option that says nothing about parents is
 * still asking for the expiring policy's parent age limit, and lives above it
 * are still outside the ask.
 */
export function governingTermsForOption(
  expiring: GoverningTerms,
  overrides: { benefit_key: string; value: string }[],
): GoverningTerms {
  const merged: GoverningTerms = { ...expiring };
  for (const o of overrides) merged[o.benefit_key] = o.value;
  return merged;
}

/**
 * How an option's deviations read on its column.
 *
 * The two numbers are different conversations. A life outside both the expiring
 * policy and this option was already a disclosed deviation and this option has
 * not moved them. A life inside the expiring terms but outside this option's is
 * somebody covered today whom the option stops asking cover for — the change an
 * RM needs to see at the moment they make it, rather than when an insurer
 * declines the life months later.
 */
export function describeOptionDeviations(count: {
  total: number;
  newlyOutside: number;
}): string | null {
  if (count.total === 0) return null;

  const lives = (n: number) => (n === 1 ? '1 life' : `${n} lives`);

  if (count.newlyOutside === 0) {
    return `${lives(count.total)} outside these terms, all already disclosed`;
  }
  if (count.newlyOutside === count.total) {
    return `${lives(count.total)} covered today fall outside these terms`;
  }
  return `${lives(count.total)} outside these terms, ${count.newlyOutside} covered today`;
}
