import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isApprover } from '@/lib/auth/roles';

export default async function Home() {
  const session = await getSession();

  if (!session) redirect('/sign-in');
  if (session.status !== 'active') redirect('/pending');

  // The deals dashboard is M1 onwards. Until then the access-request queue is
  // the only working surface, so approvers land there and everyone else gets a
  // holding page rather than a dead link.
  if (isApprover(session.role)) redirect('/admin/access-requests');

  return (
    <main className="shell">
      <header className="masthead">
        <span className="masthead__mark">Plum</span>
        <span className="masthead__meta">{session.email}</span>
      </header>
      <section className="section">
        <p className="eyebrow">Rollover quote management</p>
        <h1>Your access is active.</h1>
        <p className="standfirst">
          The deals dashboard arrives with the Salesforce sync in the next milestone. Until then
          there is nothing here for your role to do.
        </p>
      </section>
    </main>
  );
}
