import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';

export default async function PendingPage() {
  const session = await getSession();

  if (!session) redirect('/sign-in');
  if (session.status === 'active') redirect('/');

  const suspended = session.status === 'suspended';

  return (
    <main className="shell">
      <Masthead user={session} />

      <section className="section">
        <p className="eyebrow">{suspended ? 'Access suspended' : 'Awaiting approval'}</p>
        <h1>
          {suspended ? 'Your access has been suspended.' : 'Your request is with an administrator.'}
        </h1>
        <hr className="section__rule" />
        <p className="standfirst">
          {suspended
            ? 'Please speak to your administrator if you believe this is an error.'
            : 'An administrator needs to assign your role and reporting line before you can see any deals. You will not need to do anything further — sign in again once your access has been approved.'}
        </p>
      </section>
    </main>
  );
}
