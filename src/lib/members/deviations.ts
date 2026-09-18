/**
 * Where the roster sits outside the terms governing it.
 *
 * The rule that shapes all of this, settled in review: on a rollover, **nobody
 * is dropped**. A life already on the expiring policy is a continuation — the
 * insurer is being asked to carry somebody they already carry, which is a
 * different ask from admitting a new life outside the limits. So an 82-year-old
 * parent under an 80-year ceiling stays on the roster and is flagged to the
 * insurer; a deviation is a thing to disclose, never a filter.
 *
 * Terms are read rather than assumed, because they differ per deal and the same
 * benefit is written a dozen ways. Where a term cannot be read, no deviation is
 * claimed: a false flag on an insurer's desk costs more than a missed one,
 * because it teaches them to stop reading the list.
 */
import type { Relationship } from '@/lib/parsing/values';

export type GoverningTerms = Record<string, string | null>;

export type MemberForCheck = {
  id: string;
  relationship: Relationship | null;
  age: number | null;
  name: string | null;
  employeeId: string | null;
};

export type Deviation = {
  memberId: string;
  benefitKey: string;
  expectedValue: string;
  actualValue: string;
  detail: string;
  isContinuation: boolean;
};

/** Which relationships a "Members Covered" term admits. */
export function parseCoveredRelationships(value: string | null): Set<Relationship> | null {
  if (!value) return null;

  const text = value.toLowerCase();
  const covered = new Set<Relationship>();

  // An employee is implied by any group policy; the term rarely bothers to say
  // so, and a roster with no employees is a different problem entirely.
  covered.add('self');

  if (/spouse|wife|husband|partner/.test(text)) covered.add('spouse');
  if (/child|children|son|daughter|kid/.test(text)) covered.add('child');
  if (/in[\s-]?law/.test(text)) covered.add('parent_in_law');
  if (/parent|father|mother/.test(text)) covered.add('parent');
  if (/sibling|brother|sister/.test(text)) covered.add('sibling');

  // Nothing recognised beyond the implied employee means the term said
  // something this cannot read, so no claim is made about it.
  return covered.size > 1 ? covered : null;
}

/**
 * The upper age a term allows, in years.
 *
 * Deliberately narrow: a number followed by a year unit, and nothing else.
 * "Upto 80 years", "91 days - 80 years" and "80 yrs" all yield 80; anything it
 * cannot read yields null and no deviation is raised.
 */
export function parseAgeCeiling(value: string | null): number | null {
  if (!value) return null;

  const text = value.toLowerCase();
  if (/no limit|unlimited|no age limit|lifelong/.test(text)) return null;

  // The LAST year figure, because a band is written low to high and the
  // ceiling is the end of it.
  const matches = [...text.matchAll(/(\d{1,3})\s*(?:years?|yrs?)/g)];
  if (matches.length === 0) return null;

  const ceiling = Number(matches[matches.length - 1]?.[1]);
  return Number.isFinite(ceiling) && ceiling > 0 && ceiling <= 120 ? ceiling : null;
}

/** Which benefit carries the age ceiling for a given relationship. */
const AGE_BENEFIT: Partial<Record<Relationship, string>> = {
  self: 'max_age_employee_spouse',
  spouse: 'max_age_employee_spouse',
  child: 'max_age_children',
  parent: 'max_age_parents',
  parent_in_law: 'max_age_parents',
};

const RELATIONSHIP_WORDS: Record<Relationship, string> = {
  self: 'an employee',
  spouse: 'a spouse',
  child: 'a child',
  parent: 'a parent',
  parent_in_law: 'a parent-in-law',
  sibling: 'a sibling',
};

/**
 * Compares a roster against the terms governing it.
 *
 * `isContinuation` is true for every deviation found against the EXPIRING
 * policy, because by definition those lives are already on cover. Checked again
 * later against the RFQ's own terms, the same life may be a genuinely new ask —
 * which is why the source travels with the deviation rather than being inferred
 * from it afterwards.
 */
export function findDeviations(
  members: MemberForCheck[],
  terms: GoverningTerms,
  source: 'expiring_policy' | 'rfq',
): Deviation[] {
  const deviations: Deviation[] = [];
  const isContinuation = source === 'expiring_policy';

  const covered = parseCoveredRelationships(terms.members_covered ?? null);
  const siblingsTerm = terms.siblings ?? null;
  const siblingsCovered = siblingsTerm ? !/not covered|^no$|nil/i.test(siblingsTerm) : null;

  for (const member of members) {
    if (!member.relationship) continue;

    const who = RELATIONSHIP_WORDS[member.relationship];
    const label = member.name ?? member.employeeId ?? 'This life';

    // ── Relationship not admitted ─────────────────────────────────────────
    //
    // Siblings carry their own benefit on most policies, so it is consulted
    // first: a policy can decline them there and omit them from the general
    // list, and the specific term is the governing one.
    if (member.relationship === 'sibling' && siblingsCovered === false) {
      deviations.push({
        memberId: member.id,
        benefitKey: 'siblings',
        expectedValue: siblingsTerm ?? 'Not covered',
        actualValue: 'Sibling on the roster',
        detail: `${label} is a sibling, and the expiring policy does not cover siblings.`,
        isContinuation,
      });
    } else if (covered && !covered.has(member.relationship)) {
      deviations.push({
        memberId: member.id,
        benefitKey: 'members_covered',
        expectedValue: terms.members_covered ?? '',
        actualValue: member.relationship,
        detail: `${label} is ${who}, which is not among the members the policy covers.`,
        isContinuation,
      });
    }

    // ── Above the age ceiling ─────────────────────────────────────────────
    if (member.age === null) continue;

    const benefitKey = AGE_BENEFIT[member.relationship];
    if (!benefitKey) continue;

    const ceiling =
      parseAgeCeiling(terms[benefitKey] ?? null) ?? parseAgeCeiling(terms.age_band ?? null);
    if (ceiling === null || member.age <= ceiling) continue;

    deviations.push({
      memberId: member.id,
      benefitKey,
      expectedValue: `${ceiling} years`,
      actualValue: `${member.age} years`,
      detail: isContinuation
        ? `${label} is ${who} aged ${member.age}, above the ${ceiling}-year limit — already on cover, so a continuation.`
        : `${label} is ${who} aged ${member.age}, above the ${ceiling}-year limit.`,
      isContinuation,
    });
  }

  return deviations;
}

/** Grouped for a screen: one line per benefit, not per life. */
export function summariseDeviations(
  deviations: Deviation[],
): { benefitKey: string; count: number; continuations: number; example: string }[] {
  const grouped = new Map<
    string,
    { benefitKey: string; count: number; continuations: number; example: string }
  >();

  for (const d of deviations) {
    const existing = grouped.get(d.benefitKey);
    if (existing) {
      existing.count += 1;
      if (d.isContinuation) existing.continuations += 1;
    } else {
      grouped.set(d.benefitKey, {
        benefitKey: d.benefitKey,
        count: 1,
        continuations: d.isContinuation ? 1 : 0,
        example: d.detail,
      });
    }
  }

  return [...grouped.values()].sort((a, b) => b.count - a.count);
}
