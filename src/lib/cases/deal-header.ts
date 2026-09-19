import { supabaseServer } from '@/lib/db/server';
import type { DealHeader } from '@/components/deal-shell';

type Raw = {
  id: string;
  current_phase: number;
  deal_type: string;
  policy_expiry_date: string | null;
  cover_start_date: string | null;
  cover_start_change_reason: string | null;
  cover_start_change_note: string | null;
  customers: {
    brand_name: string | null;
    legal_name: string;
    industry: string | null;
    entity_type: string | null;
    location: string | null;
    linkedin_url: string | null;
  } | null;
  policies: {
    id: string;
    insurer_name: string | null;
    broker_name: string | null;
    policy_start: string | null;
    sum_insured: number | null;
    expiring_premium: number | null;
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
      'id, current_phase, deal_type, policy_expiry_date, cover_start_date, cover_start_change_reason, cover_start_change_note, customers(brand_name, legal_name, industry, entity_type, location, linkedin_url), policies(id, insurer_name, broker_name, policy_start, sum_insured, expiring_premium)',
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
      // What people call them, on every screen. The legal name is for the
      // policy, the RFQ and anything an insurer reads.
      customer_name:
        data.customers?.brand_name?.trim() || data.customers?.legal_name || 'Unnamed customer',
      deal_type: data.deal_type,
      industry: data.customers?.industry ?? null,
      entity_type: data.customers?.entity_type ?? null,
      location: data.customers?.location ?? null,
      linkedin_url: data.customers?.linkedin_url ?? null,
      legal_name: data.customers?.legal_name ?? null,
      policy_expiry_date: data.policy_expiry_date,
      cover_start_date: data.cover_start_date,
      cover_start_change_reason: data.cover_start_change_reason,
      cover_start_change_note: data.cover_start_change_note,
      insurer_name: policy?.insurer_name ?? null,
      broker_name: policy?.broker_name ?? null,
      policy_start: policy?.policy_start ?? null,
      expiring_premium: policy?.expiring_premium ?? null,
      lives: count ?? 0,
    },
    currentPhase: data.current_phase,
    policyId: policy?.id ?? null,
  };
}
