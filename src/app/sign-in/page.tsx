import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { SignInButton } from './sign-in-button';

export default async function SignInPage({ searchParams }: { searchParams: { error?: string } }) {
  const session = await getSession();
  if (session) redirect('/');

  return (
    <main className="shell">
      <header className="masthead">
        <span className="masthead__mark">Plum</span>
      </header>

      <section className="section">
        <p className="eyebrow">Rollover quote management</p>
        <h1>Sign in with your Plum account.</h1>
        <hr className="section__rule" />
        <p className="standfirst">
          Access is granted through your Google Workspace account. New colleagues are placed in an
          approval queue; an administrator assigns your role and reporting line before you can see
          any deals.
        </p>

        {searchParams.error ? (
          <div className="notice notice--error" style={{ margin: '28px 0' }}>
            <p style={{ margin: 0 }}>{searchParams.error}</p>
          </div>
        ) : null}

        <div style={{ marginTop: 28 }}>
          <SignInButton />
        </div>
      </section>
    </main>
  );
}
