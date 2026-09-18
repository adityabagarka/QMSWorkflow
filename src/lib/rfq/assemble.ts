import { supabaseServer } from '@/lib/db/server';
import { summariseRoster } from '@/lib/parsing/roster';
import type { Relationship, Gender } from '@/lib/parsing/values';

/**
 * Everything an insurer is being asked to quote on, gathered once.
 *
 * Assembled rather than queried per screen because this is what gets frozen
 * onto the RFQ at dispatch. What went out has to stay readable exactly as it
 * was sent — correcting a term or reloading a roster afterwards must not
 * rewrite the question an insurer was asked (§16), or a decline six weeks
 * later cannot be read against anything (§9, §11).
 */

export type AssembledTerm = {
  benefitKey: string;
  section: string;
  label: string;
  expiring: string | null;
  value: string | null;
  changed: boolean;
};

export type AssembledDeviation = {
  benefitKey: string;
  detail: string;
  isContinuation: boolean;
  count: number;
};

export type Assembled = {
  customer: { brandName: string; legalName: string; gstin: string | null; location: string | null };
  cover: { startsOn: string | null; expiringPremium: number | null; incumbent: string | null };
  option: { id: string; optionNo: number; name: string } | null;
  terms: AssembledTerm[];
  demography: ReturnType<typeof summariseRoster>;
  claims: { metric: string; value: number; source: 'computed' | 'stated' | 'chosen' }[];
  deviations: AssembledDeviation[];
  assembledAt: string;
};

/**
 * The figure that goes to the insurer for each claims metric.
 *
 * Where a disagreement was resolved, the resolved figure wins — that is what
 * the decision was for. Where there was never a disagreement, the computed
 * figure stands. The source travels with the number so the RFQ can say where
 * each came from rather than presenting them as uniformly ours.
 */
function claimsForRfq(
  computed: { metric: string; value: number }[],
  resolved: { metric: string; chosen_value: number | null }[],
): { metric: string; value: number; source: 'computed' | 'stated' | 'chosen' }[] {
  const decided = new Map(resolved.map((r) => [r.metric, r.chosen_value]));

  return computed.map((c) => {
    const choice = decided.get(c.metric);
    return choice === null || choice === undefined
      ? { metric: c.metric, value: c.value, source: 'computed' as const }
      : { metric: c.metric, value: choice, source: 'chosen' as const };
  });
}

export async function assembleRfq(caseId: string, optionId?: string): Promise<Assembled | null> {
  const supabase = supabaseServer();

  const { data: deal } = await supabase
    .from('cases')
    .select(
      'cover_start_date, customers(brand_name, legal_name, gstin, location), policies(id, insurer_name, expiring_premium)',
    )
    .eq('id', caseId)
    .maybeSingle<{
      cover_start_date: string | null;
      customers: {
        brand_name: string | null;
        legal_name: string;
        gstin: string | null;
        location: string | null;
      } | null;
      policies: { id: string; insurer_name: string | null; expiring_premium: number | null }[];
    }>();

  if (!deal) return null;

  const policy = deal.policies?.[0] ?? null;

  const [{ data: options }, { data: catalogue }, { data: terms }, { data: members }] =
    await Promise.all([
      supabase
        .from('rfq_options')
        .select('id, option_no, name')
        .eq('case_id', caseId)
        .order('option_no')
        .returns<{ id: string; option_no: number; name: string }[]>(),
      supabase
        .from('benefit_catalogue')
        .select('benefit_key, section, benefit_label, display_order')
        .order('display_order')
        .returns<
          { benefit_key: string; section: string; benefit_label: string; display_order: number }[]
        >(),
      policy
        ? supabase
            .from('policy_terms')
            .select('benefit_key, value')
            .eq('policy_id', policy.id)
            .returns<{ benefit_key: string; value: string | null }[]>()
        : Promise.resolve({ data: [] as { benefit_key: string; value: string | null }[] }),
      supabase
        .from('member_records')
        .select('relationship, gender, dob, age, employee_id, name_clean')
        .eq('case_id', caseId)
        .returns<
          {
            relationship: string | null;
            gender: string | null;
            dob: string | null;
            age: number | null;
            employee_id: string | null;
            name_clean: string | null;
          }[]
        >(),
    ]);

  const chosen = optionId
    ? (options ?? []).find((o) => o.id === optionId)
    : (options ?? []).find((o) => o.option_no === 1);

  const { data: overrides } = chosen
    ? await supabase
        .from('rfq_option_terms')
        .select('benefit_key, value')
        .eq('option_id', chosen.id)
        .returns<{ benefit_key: string; value: string }[]>()
    : { data: [] as { benefit_key: string; value: string }[] };

  const expiringByKey = new Map((terms ?? []).map((t) => [t.benefit_key, t.value]));
  const overrideByKey = new Map((overrides ?? []).map((o) => [o.benefit_key, o.value]));

  /*
   * Every benefit, with its full value — never "same as expiring".
   *
   * The RFQ is exported to a spreadsheet and an insurer issues a policy from
   * the option that gets chosen, so a cross-reference back to another column
   * is fine on screen and useless in the file that leaves the building.
   */
  const assembledTerms: AssembledTerm[] = (catalogue ?? []).map((b) => {
    const expiring = expiringByKey.get(b.benefit_key) ?? null;
    const override = overrideByKey.get(b.benefit_key);

    return {
      benefitKey: b.benefit_key,
      section: b.section,
      label: b.benefit_label,
      expiring,
      value: override ?? expiring,
      changed: override !== undefined && override !== expiring,
    };
  });

  const [{ data: computedClaims }, { data: resolved }, { data: deviations }] = await Promise.all([
    supabase
      .from('claims_stated_figures')
      .select('metric, value')
      .eq('case_id', caseId)
      .returns<{ metric: string; value: number }[]>(),
    supabase
      .from('claims_reconciliations')
      .select('metric, chosen_value')
      .eq('case_id', caseId)
      .returns<{ metric: string; chosen_value: number | null }[]>(),
    supabase
      .from('member_deviations')
      .select('benefit_key, detail, is_continuation')
      .eq('case_id', caseId)
      .returns<{ benefit_key: string; detail: string; is_continuation: boolean }[]>(),
  ]);

  // Grouped, because an insurer needs to know that eleven parents sit outside
  // the age band — not to read eleven near-identical sentences.
  const grouped = new Map<string, AssembledDeviation>();
  for (const d of deviations ?? []) {
    const key = `${d.benefit_key}|${d.is_continuation}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else {
      grouped.set(key, {
        benefitKey: d.benefit_key,
        detail: d.detail,
        isContinuation: d.is_continuation,
        count: 1,
      });
    }
  }

  return {
    customer: {
      brandName: deal.customers?.brand_name?.trim() || deal.customers?.legal_name || '',
      legalName: deal.customers?.legal_name ?? '',
      gstin: deal.customers?.gstin ?? null,
      location: deal.customers?.location ?? null,
    },
    cover: {
      startsOn: deal.cover_start_date,
      expiringPremium: policy?.expiring_premium ?? null,
      incumbent: policy?.insurer_name ?? null,
    },
    option: chosen ? { id: chosen.id, optionNo: chosen.option_no, name: chosen.name } : null,
    terms: assembledTerms,
    demography: summariseRoster(
      (members ?? []).map((m) => ({
        rowNumber: 0,
        employeeId: m.employee_id,
        name: m.name_clean,
        relationship: m.relationship as Relationship | null,
        gender: m.gender as Gender | null,
        dob: m.dob,
        age: m.age,
        sumInsured: null,
        joinedOn: null,
      })),
    ),
    claims: claimsForRfq(computedClaims ?? [], resolved ?? []),
    deviations: [...grouped.values()],
    assembledAt: new Date().toISOString(),
  };
}

/** Why the RFQ cannot go out yet, straight from the database. */
export async function rfqBlockers(caseId: string): Promise<string[]> {
  const supabase = supabaseServer();
  const { data } = await supabase.rpc('rfq_blockers', { p_case_id: caseId });
  return (data as string[] | null) ?? [];
}

export const BLOCKER_LABELS: Record<string, string> = {
  documents: 'All four documents must be held',
  member_data: 'The member roster has to be loaded',
  claims_reconciliation: 'Every disagreeing claims figure needs a decision',
  policy_terms: 'Every benefit must be confirmed on the expiring policy',
  rfq_options: 'At least one option to quote',
};

export const BLOCKER_STEP: Record<string, number> = {
  documents: 0,
  member_data: 2,
  claims_reconciliation: 3,
  policy_terms: 4,
  rfq_options: 4,
};
