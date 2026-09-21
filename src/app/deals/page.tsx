import Link from 'next/link';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { STAGES, stageLabel } from '@/lib/cases/phases';
import {
  NO_MONTH,
  activeFilterCount,
  monthOptions,
  monthRange,
  readDealFilters,
} from '@/lib/cases/deal-filters';
import { coverStartChip, describeCompany, formatCount, formatDate } from '@/lib/format';
import { DiscardDraft } from './draft-row';
import { DealFilterBar, type FilterOption } from './deal-filter-bar';

type DealRow = {
  id: string;
  current_phase: number;
  deal_type: string;
  cover_start_date: string | null;
  customer_id: string | null;
  customers: {
    brand_name: string | null;
    legal_name: string;
    industry: string | null;
    entity_type: string | null;
    location: string | null;
  } | null;
  owner_user_id: string;
  app_users: { name: string } | null;
  policies: { insurer_name: string | null }[] | null;
  member_records: { count: number }[];
};

/** What the filters are chosen from — every deal, before any of them apply. */
type OptionRow = {
  deal_type: string;
  cover_start_date: string | null;
  customer_id: string | null;
  customers: { brand_name: string | null; legal_name: string } | null;
  policies: { insurer_name: string | null }[] | null;
};

const DEAL_TYPE_LABELS: Record<string, string> = {
  rollover: 'Rollover',
  renewal: 'Renewal',
};

/** Options in the order a person reads them, each appearing once. */
function distinct(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const session = await requireActiveSession();
  const supabase = supabaseServer();
  const filters = readDealFilters(searchParams);

  /*
   * The options come from the deals themselves, in their own query.
   *
   * Offering every insurer in the country, or every month in the year, means
   * most choices lead to an empty list — so a control only offers what is
   * actually there. It has to be a second query rather than a count of the
   * filtered rows, or filtering by insurer would leave the insurer control
   * holding one option.
   */
  const { data: optionData } = await supabase
    .from('cases')
    .select(
      'deal_type, cover_start_date, customer_id, customers(brand_name, legal_name), policies(insurer_name)',
    )
    .returns<OptionRow[]>();

  const all = optionData ?? [];

  const customers = new Map<string, string>();
  for (const deal of all) {
    if (!deal.customer_id) continue;
    const name = deal.customers?.brand_name?.trim() || deal.customers?.legal_name;
    if (name) customers.set(deal.customer_id, name);
  }

  const customerOptions: FilterOption[] = [...customers]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const insurerOptions: FilterOption[] = distinct(
    all.map((deal) => deal.policies?.[0]?.insurer_name),
  ).map((name) => ({ value: name, label: name }));

  const dealTypeOptions: FilterOption[] = distinct(all.map((deal) => deal.deal_type)).map(
    (type) => ({ value: type, label: DEAL_TYPE_LABELS[type] ?? type }),
  );

  const months = monthOptions(all.map((deal) => deal.cover_start_date));

  /*
   * The incumbent insurer lives on `policies`, so filtering by it asks that
   * table which deals qualify and then asks for those deals.
   *
   * The one-query form — an inner join with `policies!inner(...)` — needs the
   * select string to be built at runtime, and `test:page-queries` can only
   * check a select it can read in the source. That test exists because a
   * select naming a column that had moved rendered an empty table and failed
   * silently; a filter is not worth giving up the thing that catches that.
   */
  let insurerCaseIds: string[] | null = null;
  if (filters.insurer) {
    const { data: matching } = await supabase
      .from('policies')
      .select('case_id')
      .eq('insurer_name', filters.insurer)
      .returns<{ case_id: string }[]>();

    insurerCaseIds = (matching ?? []).map((row) => row.case_id);
  }

  let query = supabase
    .from('cases')
    .select(
      'id, current_phase, deal_type, cover_start_date, customer_id, owner_user_id, customers(brand_name, legal_name, industry, entity_type, location), app_users!cases_owner_user_id_fkey(name), policies(insurer_name), member_records(count)',
    )
    .order('cover_start_date', { ascending: true, nullsFirst: false });

  if (filters.stage !== null) query = query.eq('current_phase', filters.stage);
  if (filters.customer) query = query.eq('customer_id', filters.customer);
  if (filters.dealType) query = query.eq('deal_type', filters.dealType);
  if (filters.owner === 'mine') query = query.eq('owner_user_id', session.userId);
  if (insurerCaseIds !== null) query = query.in('id', insurerCaseIds);

  if (filters.month === NO_MONTH) {
    query = query.is('cover_start_date', null);
  } else if (filters.month) {
    const { from, to } = monthRange(filters.month);
    query = query.gte('cover_start_date', from).lt('cover_start_date', to);
  }

  const { data } = await query.returns<DealRow[]>();
  const deals = data ?? [];

  /*
   * Which of these are still drafts. Asked of the database rather than guessed
   * from `current_phase`: the rule is "nobody has put anything into it", and
   * only the database can see the roster, the documents and the terms at once
   * (migration 0041). One round trip per own deal on the page, and the filters
   * make that a shorter list rather than a longer one.
   */
  const drafts = new Set<string>();
  await Promise.all(
    deals
      .filter((deal) => deal.owner_user_id === session.userId)
      .map(async (deal) => {
        const { data: isDraft } = await supabase.rpc('case_is_draft', { p_case_id: deal.id });
        if (isDraft) drafts.add(deal.id);
      }),
  );

  const filtered = activeFilterCount(filters) > 0;

  return (
    <main className="shell">
      <Masthead user={session} />

      <section className="section">
        <div className="section__head">
          <h1>Deals</h1>
          <Link className="button" href="/deals/new">
            new deal
          </Link>
        </div>

        {all.length > 0 ? (
          <DealFilterBar
            filters={filters}
            stages={STAGES.map((stage) => ({
              value: String(stage.phase),
              label: stage.label,
            }))}
            months={months}
            insurers={insurerOptions}
            customers={customerOptions}
            dealTypes={dealTypeOptions}
            showing={deals.length}
            total={all.length}
          />
        ) : null}

        {deals.length === 0 ? (
          <p className="empty">
            {filtered ? (
              <>
                No deal matches those filters. <Link href="/deals">Show everything</Link>.
              </>
            ) : (
              'Nothing here yet.'
            )}
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 28 }}>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Cover starts</th>
                  <th>Stage</th>
                  <th>Incumbent</th>
                  <th>Lives</th>
                  <th>Owner</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const chip = coverStartChip(deal.cover_start_date);
                  const lives = deal.member_records?.[0]?.count ?? 0;
                  return (
                    <tr key={deal.id}>
                      <td>
                        <Link href={`/deals/${deal.id}`}>
                          {deal.customers?.brand_name?.trim() ||
                            deal.customers?.legal_name ||
                            'Unnamed customer'}
                        </Link>
                        <div className="cell-muted" style={{ fontSize: 12.5 }}>
                          {describeCompany([
                            deal.customers?.entity_type,
                            deal.customers?.industry,
                            deal.customers?.location,
                          ])}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17 }}>
                          {formatDate(deal.cover_start_date)}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <span className={chip.className}>{chip.label}</span>
                        </div>
                      </td>
                      <td className="cell-muted">{stageLabel(deal.current_phase)}</td>
                      <td className="cell-muted">{deal.policies?.[0]?.insurer_name ?? '—'}</td>
                      <td style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>
                        {lives > 0 ? formatCount(lives) : '—'}
                      </td>
                      <td className="cell-muted">
                        {deal.owner_user_id === session.userId
                          ? 'You'
                          : (deal.app_users?.name ?? '—')}
                      </td>
                      {/* A deal nobody has put anything into can be thrown
                          away. Anything else is a record of work. */}
                      <td className="cell-muted">
                        {drafts.has(deal.id) ? <DiscardDraft dealId={deal.id} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
