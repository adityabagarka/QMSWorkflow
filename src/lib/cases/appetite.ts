import { supabaseServer } from '@/lib/db/server';

/**
 * Insurer appetite, as guidance rather than a gate.
 *
 * In the pre-approved plan workflow an insurer marked `is_acceptable = 0` is
 * excluded outright (§6, rules E-08/E-09). A rollover does not work that way:
 * the case reaches an insurer's desk by email and a person decides. Industry,
 * entity type and location are things that often attract a decline, not things
 * that cause one automatically.
 *
 * So this tells the RM what to expect — "four of nine insurers usually decline
 * this industry" — and nothing here stops a deal being created or an RFQ being
 * sent. The insurer's actual answer is recorded in insurer_rfqs.decline_reason
 * when it arrives, rather than presumed here.
 */
export type AppetiteSignal = {
  decliningInsurers: string[];
  acceptingInsurers: string[];
  totalInsurers: number;
};

export type AppetiteGuidance = {
  industry: AppetiteSignal | null;
  entityType: AppetiteSignal | null;
};

async function signalFor(
  table: 'appetite_industry' | 'appetite_entity',
  column: 'industry' | 'entity_type',
  value: string | null,
): Promise<AppetiteSignal | null> {
  if (!value) return null;

  const supabase = supabaseServer();
  const { data } = await supabase
    .from(table)
    .select('insurer, is_acceptable')
    .eq(column, value)
    .returns<{ insurer: string; is_acceptable: boolean }[]>();

  // No row for this value means we have no signal, which is different from
  // "every insurer accepts it". Say nothing rather than imply approval.
  if (!data || data.length === 0) return null;

  return {
    decliningInsurers: data
      .filter((r) => !r.is_acceptable)
      .map((r) => r.insurer)
      .sort(),
    acceptingInsurers: data
      .filter((r) => r.is_acceptable)
      .map((r) => r.insurer)
      .sort(),
    totalInsurers: data.length,
  };
}

export async function appetiteGuidance(
  industry: string | null,
  entityType: string | null,
): Promise<AppetiteGuidance> {
  const [industrySignal, entitySignal] = await Promise.all([
    signalFor('appetite_industry', 'industry', industry),
    signalFor('appetite_entity', 'entity_type', entityType),
  ]);

  return { industry: industrySignal, entityType: entitySignal };
}

/** The distinct industries and entity types the guardrails data knows about. */
export async function appetiteOptions(): Promise<{
  industries: string[];
  entityTypes: string[];
}> {
  const supabase = supabaseServer();

  const [industries, entityTypes] = await Promise.all([
    supabase.from('appetite_industry').select('industry').returns<{ industry: string }[]>(),
    supabase.from('appetite_entity').select('entity_type').returns<{ entity_type: string }[]>(),
  ]);

  return {
    industries: [...new Set((industries.data ?? []).map((r) => r.industry))].sort(),
    entityTypes: [...new Set((entityTypes.data ?? []).map((r) => r.entity_type))].sort(),
  };
}
