import { supabaseServer } from '@/lib/db/server';

/**
 * The insurers, TPAs and brokers a deal can name.
 *
 * Insurers and TPAs are closed lists — there are about thirty and twenty of
 * them, they change once or twice a year, and naming one outside the list is a
 * mistake rather than a gap. Brokers are open: there are several hundred
 * registered and we meet perhaps fifty, so the list is what we have actually
 * seen and anything new is recorded on the spot (migration 0034).
 */

export type Party = { id: string; legal_name: string; short_name: string };

export async function partyOptions(): Promise<{
  insurers: Party[];
  tpas: Party[];
  brokers: Party[];
}> {
  const supabase = supabaseServer();

  const [insurers, tpas, brokers] = await Promise.all([
    supabase
      .from('insurers')
      .select('id, legal_name, short_name')
      .eq('active', true)
      .order('short_name')
      .returns<Party[]>(),
    supabase
      .from('tpas')
      .select('id, legal_name, short_name')
      .eq('active', true)
      .order('short_name')
      .returns<Party[]>(),
    // Only the brokers offered as suggestions. One seen on a single deal is
    // still selectable by typing it — it resolves to the same row — but it does
    // not belong in a list somebody scans.
    supabase
      .from('brokers')
      .select('id, legal_name, short_name')
      .eq('status', 'listed')
      .order('short_name')
      .returns<Party[]>(),
  ]);

  return {
    insurers: insurers.data ?? [],
    tpas: tpas.data ?? [],
    brokers: brokers.data ?? [],
  };
}

/**
 * The broker record for a typed name, created if this is the first time
 * anybody has named them.
 *
 * Deliberately never fails a save. A broker we have not met before is an
 * ordinary fact about a deal; making an RM wait for an admin to approve the
 * name would block an RFQ on somebody else's inbox, and the fold key means a
 * second spelling resolves to the existing row rather than creating a twin.
 */
export async function resolveBroker(name: string | null): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;

  const supabase = supabaseServer();
  const { data } = await supabase.rpc('resolve_broker', { p_name: trimmed });

  return (data as string | null) ?? null;
}

/** The id whose short name matches, or null — never a near miss. */
export function idForName(options: Party[], name: string | null): string | null {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  const hit = options.find(
    (o) => o.short_name.toLowerCase() === wanted || o.legal_name.toLowerCase() === wanted,
  );
  return hit?.id ?? null;
}
