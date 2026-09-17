import { supabaseServer } from '@/lib/db/server';
import type { DealHeader } from '@/components/deal-shell';

type Raw = {
  id: string;
  customer_name: string;
  current_phase: number;
  industry: string | null;
  entity_type: string | null;
  cover_start_date: string | null;
  policies: {
    id: string;
    insurer_name: string | null;
    policy_start: string | null;
    sum_insured: number | null;
  }[];
};

/**
 * The header every step of a deal shows, loaded once.
 *
 * Returns null when the deal is not visible — row-level security decides that,
 * so a deal outside the caller's span is indistinguishable from one that does
 * not exist, which is the right answer.
 */
export async function loadDealHeader(dealId: string): Promise<{
  header: DealHeader;
  currentPhase: number;
  policyId: string | null;
} | null> {
  const supabase = supabaseServer();

  const { data } = await supabase
    .from('cases')
    .select(
      'id, customer_name, current_phase, industry, entity_type, cover_start_date, policies(id, insurer_name, policy_start, sum_insured)',
    )
    .eq('id', dealId)
    .maybeSingle<Raw>();

  if (!data) return null;

  const policy = data.policies?.[0] ?? null;

  const { count } = await supabase
    .from('member_records')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', dealId);

  return {
    header: {
      id: data.id,
      customer_name: data.customer_name,
      industry: data.industry,
      entity_type: data.entity_type,
      cover_start_date: data.cover_start_date,
      insurer_name: policy?.insurer_name ?? null,
      policy_start: policy?.policy_start ?? null,
      sum_insured: policy?.sum_insured ?? null,
      // Premium lives on the expiring policy and is captured during policy
      // review; null until then rather than shown as zero.
      expiring_premium: null,
      lives: count ?? 0,
    },
    currentPhase: data.current_phase,
    policyId: policy?.id ?? null,
  };
}
