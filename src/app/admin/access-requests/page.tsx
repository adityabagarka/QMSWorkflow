import { requireApprover } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { ROLE_LABELS, type Role } from '@/lib/auth/roles';
import { RequestRow } from './request-row';

type PersonRow = {
  id: string;
  email: string;
  name: string;
  role: Role | null;
  status: 'pending' | 'active' | 'suspended';
  manager_id: string | null;
  created_at: string;
};

export default async function AccessPage() {
  const session = await requireApprover();
  const supabase = supabaseServer();

  // Everyone, not just people with a pending request row. The queue used to be
  // built from access_requests, which meant anyone whose request row was
  // missing or already resolved simply disappeared — stuck, with nothing on
  // screen to explain it. `status` is the durable fact.
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, name, role, status, manager_id, created_at')
    .order('created_at', { ascending: true })
    .returns<PersonRow[]>();

  const people = data ?? [];
  const waiting = people.filter((p) => p.status === 'pending');
  const settled = people.filter((p) => p.status !== 'pending');
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  const managers = people
    .filter((p) => p.status === 'active')
    .map((p) => ({ id: p.id, name: p.name, email: p.email }));

  return (
    <main className="shell">
      <Masthead meta={`${session.email} · ${session.role ? ROLE_LABELS[session.role] : ''}`} />

      <section className="section">
        <p className="eyebrow">Administration</p>
        <h1>Who can get in.</h1>
        <hr className="section__rule" />
        <p className="standfirst">
          Anyone who signs in with a permitted address arrives here first, holding no role and
          seeing no deals. Approving assigns both a role and a reporting line — deal visibility for
          everyone in the hierarchy is computed by walking that line, so it cannot be left blank.
        </p>

        {error ? (
          <div className="notice notice--error" style={{ marginTop: 24 }}>
            <p style={{ margin: 0 }}>Could not load the people list: {error.message}</p>
          </div>
        ) : null}

        <h2 style={{ marginTop: 40 }}>Waiting for a decision</h2>
        {waiting.length === 0 ? (
          <p className="empty">Nobody is waiting.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 20 }}>
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Since</th>
                  <th>Waiting</th>
                  <th colSpan={3}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((person) => (
                  <RequestRow
                    key={person.id}
                    userId={person.id}
                    name={person.name}
                    email={person.email}
                    requestedAt={person.created_at}
                    managers={managers.filter((m) => m.id !== person.id)}
                    canGrantSuperAdmin={session.role === 'super_admin'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <p className="eyebrow">Everyone else</p>
        <h2>People with access.</h2>
        <hr className="section__rule" />
        <p className="standfirst">
          The reporting line shown here is what the database walks to decide who sees which deals.
        </p>

        {settled.length === 0 ? (
          <p className="empty">Nobody has been approved yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Reports to</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {settled.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <div>{person.name}</div>
                      <div className="cell-muted" style={{ fontSize: 13 }}>
                        {person.email}
                      </div>
                    </td>
                    <td className="cell-muted">{person.role ? ROLE_LABELS[person.role] : '—'}</td>
                    <td className="cell-muted">
                      {person.manager_id ? (nameById.get(person.manager_id) ?? 'Unknown') : '—'}
                    </td>
                    <td>
                      <span
                        className={
                          person.status === 'active' ? 'chip chip--settled' : 'chip chip--urgent'
                        }
                      >
                        {person.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
