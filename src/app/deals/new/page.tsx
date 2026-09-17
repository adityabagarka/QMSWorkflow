import Link from 'next/link';
import { requireActiveSession } from '@/lib/auth/session';
import { Masthead } from '@/components/masthead';
import { appetiteOptions } from '@/lib/cases/appetite';
import { DealForm } from './deal-form';

export default async function NewDealPage() {
  const session = await requireActiveSession();
  const { industries, entityTypes } = await appetiteOptions();

  return (
    <main className="shell">
      <Masthead user={session} />

      <section className="section">
        <p className="eyebrow">New rollover deal</p>
        <h1>Start with what you know.</h1>
        <hr className="section__rule" />
        <p className="standfirst">
          Only the customer name is needed to begin. The expiring policy, member roster and claims
          history are added next, and each one narrows what the insurers are being asked to quote.
        </p>

        <div style={{ marginTop: 32 }}>
          <DealForm industries={industries} entityTypes={entityTypes} />
        </div>

        <p style={{ marginTop: 32 }}>
          <Link href="/deals">Back to deals</Link>
        </p>
      </section>
    </main>
  );
}
