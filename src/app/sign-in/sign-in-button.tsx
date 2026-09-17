'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export function SignInButton() {
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Deliberately no `hd` parameter. It would restrict Google's account
    // chooser to a single Workspace domain, and more than one domain is
    // allowed to sign in (see allowed_email_domains) — including the one the
    // bootstrap Super Admin uses. Setting `hd` would lock that account out of
    // its own first sign-in.
    //
    // Nothing is lost by omitting it: `hd` is a convenience, never the control.
    // The real gate is app.is_allowed_email_domain() in the database, which
    // rejects a disallowed address before any user row is created.
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <button className="button" onClick={signIn} disabled={busy}>
      {busy ? 'signing in…' : 'sign in with google'}
    </button>
  );
}
