'use client';

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

// Read at module scope, not inside the handler: Next.js inlines NEXT_PUBLIC_*
// values at build time by substituting these exact expressions, so they must
// appear literally rather than being looked up dynamically.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Google's own four-colour mark, inline.
 *
 * Inline rather than a hosted file so the button never renders wordless on a
 * slow or blocked network — an identity button that loses its mark is exactly
 * the thing people are told to be suspicious of.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

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
    <button className="google-button" onClick={signIn} disabled={busy} type="button">
      <GoogleMark />
      <span>{busy ? 'Signing in…' : 'Sign in with Google'}</span>
    </button>
  );
}
