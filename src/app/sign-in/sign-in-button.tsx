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

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Restricts the Google account chooser to the Workspace domain. This is
        // a convenience, not the control: the allowlist is enforced in the
        // database by app.is_allowed_email_domain().
        queryParams: { hd: process.env.NEXT_PUBLIC_PRIMARY_EMAIL_DOMAIN ?? '' },
      },
    });
  }

  return (
    <button className="button" onClick={signIn} disabled={busy}>
      {busy ? 'signing in…' : 'sign in with google'}
    </button>
  );
}
