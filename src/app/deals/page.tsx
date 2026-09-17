import Link from 'next/link';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { stageLabel } from '@/lib/cases/phases';
import { coverStartChip, describeCompany, formatCount, formatDate } from '@/lib/format';

type DealRow = {
  id: string;
  customer_name: string;
  current_phase: number;
  industry: string | null;
  entity_type: string | null;
  location: string | null;
  cover_start_date: string | null;
  owner_user_id: string;
  app_users: { name: string } | null;
  member_records: { count: number }[];
};

export default async function DealsPage() {
  const session = await requireActiveSession();
  const supabase = supabaseServer();

  const { data } = await supabase
    .from('cases')
    .select(
      'id, customer_name, current_phase, industry, entity_type, location, cover_start_date, owner_user_id, app_users!cases_owner_user_id_fkey(name), member_records(count)',
    )
    .order('cover_start_date', { ascending: true, nullsFirst: false })
    .returns<DealRow[]>();

  const deals = data ?? [];

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

        {deals.length === 0 ? (
          <p className="empty">Nothing here yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 28 }}>
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Cover starts</th>
                  <th>Stage</th>
                  <th>Lives</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const chip = coverStartChip(deal.cover_start_date);
                  const lives = deal.member_records?.[0]?.count ?? 0;
                  return (
                    <tr key={deal.id}>
                      <td>
                        <Link href={`/deals/${deal.id}`}>{deal.customer_name}</Link>
                        <div className="cell-muted" style={{ fontSize: 12.5 }}>
                          {describeCompany([deal.entity_type, deal.industry, deal.location])}
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
                      <td style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>
                        {lives > 0 ? formatCount(lives) : '—'}
                      </td>
                      <td className="cell-muted">
                        {deal.owner_user_id === session.userId
                          ? 'You'
                          : (deal.app_users?.name ?? '—')}
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
