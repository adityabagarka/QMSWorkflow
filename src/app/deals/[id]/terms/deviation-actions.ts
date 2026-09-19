'use server';

import { supabaseServer } from '@/lib/db/server';
import { getSession } from '@/lib/auth/session';
import { findDeviations, type GoverningTerms } from '@/lib/members/deviations';
import type { Relationship } from '@/lib/parsing/values';
import { governingTermsForOption } from '@/lib/members/option-deviations';

export type OptionDeviationCount = {
  total: number;
  /**
   * Lives inside the expiring policy's terms but outside this option's.
   *
   * The expensive, surprising case: somebody properly covered today who this
   * option would stop asking cover for. Distinct from a life already outside
   * the expiring terms, who is a disclosed deviation either way and whose
   * position this option does not change.
   */
  newlyOutside: number;
};

/**
 * Checks the roster against what each option actually asks insurers for.
 *
 * The roster is checked against the expiring policy when it is uploaded, which
 * answers "who is outside the cover they have". This answers the different and
 * more expensive question: "who would be outside the cover we are about to ask
 * for" — which is what an RM is deciding when they lower a parent age ceiling
 * or drop a relationship from an option, and is precisely the consequence that
 * does not show up until an insurer declines a life months later.
 *
 * Re-runnable and per option: re-running replaces that option's rows and leaves
 * every other option, and the expiring-policy pass, alone (migration 0040).
 */
export async function detectOptionDeviations(
  dealId: string,
): Promise<Record<string, OptionDeviationCount>> {
  const session = await getSession();
  if (!session || session.status !== 'active') return {};

  const supabase = supabaseServer();

  const { data: policy } = await supabase
    .from('policies')
    .select('id')
    .eq('case_id', dealId)
    .maybeSingle<{ id: string }>();

  const [{ data: options }, { data: members }, { data: expiringTerms }, { data: overrides }] =
    await Promise.all([
      supabase.from('rfq_options').select('id').eq('case_id', dealId).returns<{ id: string }[]>(),
      supabase
        .from('member_records')
        .select('id, relationship, age, name_clean, employee_id')
        .eq('case_id', dealId)
        .returns<
          {
            id: string;
            relationship: string | null;
            age: number | null;
            name_clean: string | null;
            employee_id: string | null;
          }[]
        >(),
      policy
        ? supabase
            .from('policy_terms')
            .select('benefit_key, value')
            .eq('policy_id', policy.id)
            .returns<{ benefit_key: string; value: string | null }[]>()
        : Promise.resolve({ data: [] as { benefit_key: string; value: string | null }[] }),
      supabase
        .from('rfq_option_terms')
        .select('option_id, benefit_key, value')
        .eq('case_id', dealId)
        .returns<{ option_id: string; benefit_key: string; value: string }[]>(),
    ]);

  // Nothing to check against, or nobody to check. Not an error: a deal reaches
  // the terms step long before the roster arrives.
  if (!options?.length || !members?.length) return {};

  const expiring: GoverningTerms = {};
  for (const t of expiringTerms ?? []) expiring[t.benefit_key] = t.value;

  const forCheck = members.map((m) => ({
    id: m.id,
    relationship: m.relationship as Relationship | null,
    age: m.age,
    name: m.name_clean,
    employeeId: m.employee_id,
  }));

  /*
   * Who is already outside the expiring policy, by term.
   *
   * A life outside an option's terms means two different things depending on
   * this. Outside the option but inside the expiring policy is somebody
   * properly covered today whom the option stops asking for — the change worth
   * noticing. Outside both was already a disclosed deviation, and the option
   * has not changed their position.
   */
  const alreadyOutside = new Set(
    findDeviations(forCheck, expiring, 'expiring_policy').map(
      (d) => `${d.memberId}:${d.benefitKey}`,
    ),
  );

  const counts: Record<string, OptionDeviationCount> = {};

  for (const option of options) {
    const found = findDeviations(
      forCheck,
      governingTermsForOption(
        expiring,
        (overrides ?? []).filter((o) => o.option_id === option.id),
      ),
      'rfq',
    );

    await supabase
      .from('member_deviations')
      .delete()
      .eq('case_id', dealId)
      .eq('source', 'rfq')
      .eq('option_id', option.id);

    if (found.length > 0) {
      await supabase.from('member_deviations').insert(
        found.map((d) => ({
          case_id: dealId,
          member_record_id: d.memberId,
          benefit_key: d.benefitKey,
          source: 'rfq' as const,
          option_id: option.id,
          expected_value: d.expectedValue,
          actual_value: d.actualValue,
          detail: d.detail,
          is_continuation: d.isContinuation,
        })),
      );
    }

    counts[option.id] = {
      total: found.length,
      newlyOutside: found.filter((d) => !alreadyOutside.has(`${d.memberId}:${d.benefitKey}`))
        .length,
    };
  }

  return counts;
}
