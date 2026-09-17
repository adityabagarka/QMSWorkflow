import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isApprover } from '@/lib/auth/roles';

/**
 * The root is a router, not a page: it sends each person to the first screen
 * that is actually theirs. Approvers land on the access-request queue, everyone
 * else on their deals.
 */
export default async function Home() {
  const session = await getSession();

  if (!session) redirect('/sign-in');
  if (session.status !== 'active') redirect('/pending');
  if (isApprover(session.role)) redirect('/admin/access-requests');

  redirect('/deals');
}
