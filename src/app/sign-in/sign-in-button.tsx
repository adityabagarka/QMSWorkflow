'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// Read at module scope, not inside the handler: Next.js inlines NEXT_PUBLIC_*
// values at build time by substituting these exact expressions, so they must
// appear literally rather than being looked up dynamically.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function SignInButton() {
  const [busy, setBusy] = useState(false);

  // If these are missing the button cannot work, so say why rather than
  // failing on click. The usual cause is storing them on the host as
  // write-only secrets, which the build cannot read.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div className="notice notice--error">
        <p className="eyebrow">Configuration incomplete</p>
        <p style={{ margin: 0 }}>
          Sign-in is not available because this deployment is missing its Supabase settings. An
          administrator needs to add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> as configuration (not as write-only secrets)
          and redeploy.
        </p>
      </div>
    );
  }

  async function signIn() {
    setBusy(true);
    const supabase = createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);

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
