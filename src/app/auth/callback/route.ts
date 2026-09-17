import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/db/server';

/**
 * OAuth callback.
 *
 * Exchanges the Google authorisation code for a session, then provisions the
 * application user. Provisioning is a single SECURITY DEFINER call (§15,
 * migration 0011) so that the domain allowlist, the pending user row, the
 * access request and the audit entry either all happen or none do.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return redirectToSignIn(url, 'Sign-in was cancelled or the link has expired.');
  }

  const supabase = supabaseServer();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectToSignIn(url, 'We could not complete sign-in. Please try again.');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return redirectToSignIn(url, 'Google did not return an email address for this account.');
  }

  const { data, error } = await supabase
    .rpc('provision_signed_in_user', {
      p_user_id: user.id,
      p_email: user.email,
      p_name: (user.user_metadata?.full_name as string | undefined) ?? '',
    })
    .single<{ status: string; role: string | null }>();

  if (error) {
    // Sign the session out either way: a half-provisioned visitor must not be
    // left holding a valid token.
    await supabase.auth.signOut();

    // Postgres raises 42501 (insufficient_privilege) for an address outside
    // allowed_email_domains. That is the expected path and deserves the
    // specific message. Anything else is a fault on our side, and saying
    // "not permitted" for it sends people hunting through their Google
    // settings for a problem that is not there — which is exactly what
    // happened when these functions were unreachable from PostgREST.
    const rejectedDomain = error.code === '42501';

    if (!rejectedDomain) {
      console.error('[auth/callback] provisioning failed', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
    }

    return redirectToSignIn(
      url,
      rejectedDomain
        ? 'This account is not permitted to use the system. Please sign in with your Plum Workspace account.'
        : 'Sign-in could not be completed because of a problem on our side, not with your account. ' +
            'Please tell an administrator, who can find the details in the deployment logs.',
    );
  }

  return NextResponse.redirect(new URL(data?.status === 'active' ? '/' : '/pending', url.origin));
}

function redirectToSignIn(url: URL, message: string) {
  const target = new URL('/sign-in', url.origin);
  target.searchParams.set('error', message);
  return NextResponse.redirect(target);
}
