import Link from 'next/link';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { phaseLabel } from '@/lib/cases/phases';

type DealRow = {
  id: string;
  customer_name: string;
  current_phase: number;
  state: string;
  policy_expiry_date: string | null;
  updated_at: string;
  owner_user_id: string;
  app_users: { name: string; email: string } | null;
};

/** Days until expiry, mapped onto the design system's four-step severity scale. */
function expiryChip(expiry: string | null) {
  if (!expiry) return { className: 'chip chip--settled', label: 'no expiry set' };

  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);

  if (days < 0) return { className: 'chip chip--critical', label: 'expired' };
  if (days <= 15) return { className: 'chip chip--critical', label: `${days}d to expiry` };
  if (days <= 30) return { className: 'chip chip--urgent', label: `${days}d to expiry` };
  if (days <= 60) return { className: 'chip chip--waiting', label: `${days}d to expiry` };
  return { className: 'chip', label: `${days}d to expiry` };
}

export default async function DealsPage() {
  const session = await requireActiveSession();
  const supabase = supabaseServer();

  // No scope filter: row-level security already limits this to the caller's
  // own deals plus their reporting subtree (§15). Filtering again in the query
  // would be a second, divergent copy of the rule.
  const { data } = await supabase
    .from('cases')
    .select(
      'id, customer_name, current_phase, state, policy_expiry_date, updated_at, owner_user_id, app_users!cases_owner_user_id_fkey(name, email)',
    )
    .order('updated_at', { ascending: false })
    .returns<DealRow[]>();

  const deals = data ?? [];

  return (
    <main className="shell">
      <Masthead meta={session.email} />

      <section className="section">
        <p className="eyebrow">Rollover deals</p>
        <div className="section__head">
          <h1>Your deals.</h1>
          <Link className="button" href="/deals/new">
            new deal
          </Link>
        </div>
        <hr className="section__rule" />
        <p className="standfirst">
          Your own deals, and those of anyone reporting to you. A colleague at your own level cannot
          see these, and you cannot see theirs.
        </p>

        {deals.length === 0 ? (
          <p className="empty">No deals yet. Start one and the phase tracker fills in as you go.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 32 }}>
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phase</th>
                  <th>Expiry</th>
                  <th>Owner</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const chip = expiryChip(deal.policy_expiry_date);
                  const isMine = deal.owner_user_id === session.userId;
                  return (
                    <tr key={deal.id}>
                      <td>
                        <Link href={`/deals/${deal.id}`}>{deal.customer_name}</Link>
                      </td>
                      <td className="cell-muted">{phaseLabel(deal.current_phase)}</td>
                      <td>
                        <span className={chip.className}>{chip.label}</span>
                      </td>
                      <td className="cell-muted">
                        {isMine ? 'You' : (deal.app_users?.name ?? 'Unknown')}
                      </td>
                      <td className="cell-muted">
                        {new Date(deal.updated_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
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
