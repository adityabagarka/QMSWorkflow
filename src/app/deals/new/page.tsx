import Link from 'next/link';
import { requireActiveSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';
import { DealForm } from './deal-form';

export default async function NewDealPage() {
  const session = await requireActiveSession();

  return (
    <main className="shell">
      <Masthead user={session} />

      <section className="section">
        <p className="eyebrow">New rollover deal</p>
        <h1>Start with what you know.</h1>
        <hr className="section__rule" />
        <p className="standfirst">
          Name the customer and we have somewhere to put the paperwork. The expiring policy, member
          roster and claims history come next — most of what the deal needs is read out of them, so
          there is little left to type.
        </p>

        <div style={{ marginTop: 32 }}>
          <DealForm />
        </div>

        <p style={{ marginTop: 32 }}>
          <Link href="/deals">Back to deals</Link>
        </p>
      </section>
    </main>
  );
}
