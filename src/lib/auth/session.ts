import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/db/server';
import { supabaseEnv } from '@/lib/db/env';
import { APPROVER_ROLES, type Role } from '@/lib/auth/roles';

export type Session = {
  userId: string;
  email: string;
  name: string;
  role: Role | null;
  status: 'pending' | 'active' | 'suspended';
};

/**
 * Resolves the signed-in user's application identity, or null if nobody is
 * signed in.
 *
 * Reads app_users rather than trusting the JWT's claims for role: a role can be
 * changed or revoked between token refreshes, and RLS resolves it from the
 * table anyway. The two must not be able to disagree.
 */
export async function getSession(): Promise<Session | null> {
  // Without the Supabase settings there is no way to have a session, and
  // "nobody is signed in" is the truthful answer. Throwing here would instead
  // take down every page in the app, including the sign-in page that explains
  // how to fix the configuration.
  if (!supabaseEnv()) return null;

  const supabase = supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const { data } = await supabase
    .from('app_users')
    .select('id, email, name, role, status')
    .eq('id', user.id)
    .maybeSingle<{
      id: string;
      email: string;
      name: string;
      role: Role | null;
      status: Session['status'];
    }>();

  if (!data) return null;

  return {
    userId: data.id,
    email: data.email,
    name: data.name,
    role: data.role,
    status: data.status,
  };
}

/** Requires an active user; sends pending and suspended users to the holding page. */
export async function requireActiveSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/sign-in');
  if (session.status !== 'active') redirect('/pending');
  return session;
}

/**
 * Requires a role §15 permits to approve access requests.
 *
 * This is a convenience for rendering, not the security boundary: the boundary
 * is RLS plus app.decide_access_request(). A missed check here shows the wrong
 * page; it does not grant anything.
 */
export async function requireApprover(): Promise<Session> {
  const session = await requireActiveSession();
  if (!session.role || !APPROVER_ROLES.includes(session.role)) {
    redirect('/');
  }
  return session;
}
