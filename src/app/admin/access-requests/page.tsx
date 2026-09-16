import { requireApprover } from '@/lib/auth/session';
import { ROLE_LABELS, type Role } from '@/lib/auth/roles';
import { supabaseServer } from '@/lib/db/server';
import { RequestRow } from './request-row';

type PendingRequest = {
  id: string;
  created_at: string;
  requested_role: Role | null;
  app_users: { id: string; email: string; name: string } | null;
};

export default async function AccessRequestsPage() {
  const session = await requireApprover();
  const supabase = supabaseServer();

  const [{ data: requests }, { data: managers }] = await Promise.all([
    supabase
      .from('access_requests')
      .select(
        'id, created_at, requested_role, app_users!access_requests_requested_by_fkey(id, email, name)',
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .returns<PendingRequest[]>(),
    // Anyone active can be named as a manager; §15's hierarchy is this
    // system's own reporting structure, not a Salesforce role field, so it is
    // not limited to people holding the Manager role.
    supabase
      .from('app_users')
      .select('id, name, email')
      .eq('status', 'active')
      .order('name')
      .returns<{ id: string; name: string; email: string }[]>(),
  ]);

  const pending = requests ?? [];

  return (
    <main className="shell">
      <header className="masthead">
        <span className="masthead__mark">Plum</span>
        <span className="masthead__meta">
          {session.email} · {session.role ? ROLE_LABELS[session.role] : ''}
        </span>
      </header>

      <section className="section">
        <p className="eyebrow">Administration</p>
        <h1>Access requests.</h1>
        <hr className="section__rule" />
        <p className="standfirst">
          Every new colleague arrives here after signing in with their Workspace account. Approving
          assigns both a role and a reporting line; deal visibility for Managers, Leaders and Heads
          of Department is computed by walking that line, so it cannot be left blank.
        </p>

        {pending.length === 0 ? (
          <p className="empty">Nothing is waiting for a decision.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 32 }}>
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Reports to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((request) => (
                  <RequestRow
                    key={request.id}
                    requestId={request.id}
                    name={request.app_users?.name ?? 'Unknown'}
                    email={request.app_users?.email ?? ''}
                    requestedAt={request.created_at}
                    managers={(managers ?? []).filter((m) => m.id !== request.app_users?.id)}
                    canGrantSuperAdmin={session.role === 'super_admin'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
