import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { TermsGrid, type OptionColumn, type TermRow } from './terms-grid';
import { PolicyPanel } from './policy-panel';

export default async function TermsPage({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase, policyId } = loaded;
  const supabase = supabaseServer();

  const [catalogue, terms, options, overrides, docs] = await Promise.all([
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
      .eq('case_id', header.id)
      .order('option_no')
      .returns<{ id: string; option_no: number; name: string }[]>(),
    supabase
      .from('rfq_option_terms')
      .select('option_id, benefit_key, value')
      .eq('case_id', header.id)
      .returns<{ option_id: string; benefit_key: string; value: string }[]>(),
    supabase
      .from('policy_documents')
      .select('id, file_ref, doc_type')
      .eq('case_id', header.id)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .returns<{ id: string; file_ref: string; doc_type: string }[]>(),
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
  const policyDoc = docs.data?.[0] ?? null;

  return (
    <main className="shell shell--wide">
      <Masthead meta={session.email} />

      <DealShell
        deal={header}
        currentPhase={4}
        maxReachedPhase={Math.max(currentPhase, 4)}
        title="Terms and options"
        back={stageHref(header.id, 3)}
        next={stageHref(header.id, 5)}
        nextLabel="build the RFQ"
        nextDisabled={outstanding > 0}
        wideAside
        nextNote={
          outstanding > 0
            ? `${outstanding} of ${rows.length} still to confirm`
            : `All ${rows.length} confirmed`
        }
        aside={
          <div className="aside-block">
            <h3>Expiring policy</h3>
            {/* The policy sits beside the terms it describes, so checking a
                clause is a glance rather than a trip to the documents screen
                and back. */}
            <PolicyPanel caseId={header.id} fileRef={policyDoc?.file_ref ?? null} />
          </div>
        }
      >
        {optionColumns.length === 0 ? (
          <p className="empty">
            No options yet. Option 1 is the expiring terms unchanged; add more to vary them.
          </p>
        ) : (
          <TermsGrid rows={rows} options={optionColumns} />
        )}
      </DealShell>
    </main>
  );
}
