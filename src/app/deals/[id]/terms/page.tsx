import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { TermsGrid, type ChangeKind, type OptionColumn, type TermRow } from './terms-grid';
import { PolicyPanel } from './policy-panel';
import { ExtractPanel } from './extract-panel';
import { extractionConfigured } from '@/lib/extraction/policy';

type TermRecord = {
  benefit_key: string;
  value: string | null;
  review_status: string;
  evidence_quote: string | null;
  evidence_page: number | null;
};

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
          .select('benefit_key, value, review_status, evidence_quote, evidence_page')
          .eq('policy_id', policyId)
          .returns<TermRecord[]>()
      : Promise.resolve({ data: [] as TermRecord[] }),
    supabase
      .from('rfq_options')
      .select('id, option_no, name')
      .eq('case_id', header.id)
      .order('option_no')
      .returns<{ id: string; option_no: number; name: string }[]>(),
    supabase
      .from('rfq_option_terms')
      .select('option_id, benefit_key, value, change_kind_override')
      .eq('case_id', header.id)
      .returns<
        {
          option_id: string;
          benefit_key: string;
          value: string;
          change_kind_override: ChangeKind | null;
        }[]
      >(),
    // The documents step writes `case_documents`; `policy_documents` predates
    // it and nothing fills it, so reading that here showed "no policy copy"
    // beside a policy that had been uploaded twenty minutes earlier.
    supabase
      .from('case_documents')
      .select('id, file_ref, file_name')
      .eq('case_id', header.id)
      .eq('kind', 'policy_copy')
      .maybeSingle<{ id: string; file_ref: string; file_name: string }>(),
  ]);

  const termByKey = new Map((terms.data ?? []).map((t) => [t.benefit_key, t]));

  // Classify every override in one round trip rather than per cell.
  const overrideRows = overrides.data ?? [];
  const classified = await Promise.all(
    overrideRows.map(async (o) => {
      if (o.change_kind_override) return { ...o, kind: o.change_kind_override };
      const { data } = await supabase.rpc('classify_term_change', {
        p_benefit_key: o.benefit_key,
        p_from: termByKey.get(o.benefit_key)?.value ?? null,
        p_to: o.value,
      });
      return { ...o, kind: (data as ChangeKind | null) ?? 'changed' };
    }),
  );

  const cellsByKey = new Map<string, Record<string, { value: string; kind: ChangeKind }>>();
  for (const o of classified) {
    const existing = cellsByKey.get(o.benefit_key) ?? {};
    existing[o.option_id] = { value: o.value, kind: o.kind };
    cellsByKey.set(o.benefit_key, existing);
  }

  const optionIds = (options.data ?? []).map((o) => o.id);

  const rows: TermRow[] = (catalogue.data ?? []).map((b) => {
    const term = termByKey.get(b.benefit_key);
    const expiring = term?.value ?? null;
    const changedCells = cellsByKey.get(b.benefit_key) ?? {};

    // Every option carries the full term. Where it does not override, that is
    // the expiring value spelled out — not a reference to it, because this
    // table becomes the Excel an insurer issues a policy from.
    const cells = Object.fromEntries(
      optionIds.map((id) => {
        const override = changedCells[id];
        return [
          id,
          override
            ? { value: override.value, changed: true, kind: override.kind }
            : { value: expiring, changed: false, kind: null },
        ];
      }),
    );

    return {
      benefitKey: b.benefit_key,
      section: b.section,
      label: b.benefit_label,
      expiring,
      reviewed: Boolean(term && term.review_status !== 'proposed'),
      evidence: term?.evidence_quote ?? null,
      evidencePage: term?.evidence_page ?? null,
      cells,
    };
  });

  const optionColumns: OptionColumn[] = (options.data ?? []).map((o) => ({
    id: o.id,
    optionNo: o.option_no,
    name: o.name,
  }));

  const confirmed = rows.filter((r) => r.reviewed).length;
  const outstanding = rows.length - confirmed;
  const policyDoc = docs.data ?? null;

  return (
    <main className="shell shell--wide">
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />

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
        <ExtractPanel
          dealId={header.id}
          fileName={policyDoc?.file_name ?? null}
          configured={extractionConfigured()}
          alreadyRead={rows.some((r) => r.evidence !== null)}
        />

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
