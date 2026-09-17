import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { STAGES, stageHref } from '@/lib/cases/phases';
import { TermsGrid, type OptionColumn, type TermRow } from './terms-grid';

export default async function TermsPage({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const supabase = supabaseServer();

  const { data: deal } = await supabase
    .from('cases')
    .select('id, customer_name, current_phase, policies(id)')
    .eq('id', params.id)
    .maybeSingle<{
      id: string;
      customer_name: string;
      current_phase: number;
      policies: { id: string }[];
    }>();

  if (!deal) notFound();
  const policyId = deal.policies?.[0]?.id ?? null;

  const [catalogue, terms, options, overrides] = await Promise.all([
    supabase
      .from('benefit_catalogue')
      .select('benefit_key, section, benefit_label, display_order')
      .order('display_order')
      .returns<
        { benefit_key: string; section: string; benefit_label: string; display_order: number }[]
      >(),
    policyId
      ? supabase
          .from('policy_terms')
          .select('benefit_key, value, review_status')
          .eq('policy_id', policyId)
          .returns<{ benefit_key: string; value: string | null; review_status: string }[]>()
      : Promise.resolve({
          data: [] as { benefit_key: string; value: string | null; review_status: string }[],
        }),
    supabase
      .from('rfq_options')
      .select('id, option_no, name')
      .eq('case_id', deal.id)
      .order('option_no')
      .returns<{ id: string; option_no: number; name: string }[]>(),
    supabase
      .from('rfq_option_terms')
      .select('option_id, benefit_key, value')
      .eq('case_id', deal.id)
      .returns<{ option_id: string; benefit_key: string; value: string }[]>(),
  ]);

  const termByKey = new Map((terms.data ?? []).map((t) => [t.benefit_key, t]));
  const overrideByKey = new Map<string, Record<string, string>>();
  for (const o of overrides.data ?? []) {
    const existing = overrideByKey.get(o.benefit_key) ?? {};
    existing[o.option_id] = o.value;
    overrideByKey.set(o.benefit_key, existing);
  }

  const rows: TermRow[] = (catalogue.data ?? []).map((b) => {
    const term = termByKey.get(b.benefit_key);
    return {
      benefitKey: b.benefit_key,
      section: b.section,
      label: b.benefit_label,
      expiring: term?.value ?? null,
      reviewed: Boolean(term && term.review_status !== 'proposed'),
      overrides: overrideByKey.get(b.benefit_key) ?? {},
    };
  });

  const optionColumns: OptionColumn[] = (options.data ?? []).map((o) => ({
    id: o.id,
    optionNo: o.option_no,
    name: o.name,
  }));

  const confirmed = rows.filter((r) => r.reviewed).length;
  const outstanding = rows.length - confirmed;

  return (
    <main className="shell">
      <Masthead meta={session.email} />

      <div className="crumb">
        <Link href={`/deals/${deal.id}`}>← {deal.customer_name}</Link>
      </div>

      <nav className="wiz">
        {STAGES.map((stage) => (
          <Link
            key={stage.phase}
            href={stageHref(deal.id, stage.phase)}
            className={stage.phase === 4 ? 'is-now' : stage.phase < 4 ? 'is-done' : undefined}
          >
            <span className="wiz__n">{stage.phase + 1}</span>
            <span className="wiz__t">{stage.label}</span>
          </Link>
        ))}
      </nav>

      <section className="section">
        <div className="section__head">
          <h1>Terms</h1>
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            {confirmed} of {rows.length} confirmed
          </span>
        </div>

        {optionColumns.length === 0 ? (
          <p className="empty">
            No options yet. Option 1 is the expiring terms unchanged; add more to vary them.
          </p>
        ) : (
          <div style={{ marginTop: 24 }}>
            <TermsGrid rows={rows} options={optionColumns} />
          </div>
        )}

        <div className="terms__foot">
          <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>
            {outstanding > 0
              ? `${outstanding} benefits still to confirm before this can go to insurers.`
              : 'Every benefit is confirmed.'}
          </span>
          <button className="button" type="button" disabled={outstanding > 0}>
            send to insurers
          </button>
        </div>
      </section>
    </main>
  );
}
