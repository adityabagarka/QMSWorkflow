import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv } from '@/lib/db/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client bound to the signed-in user's session.
 *
 * Every query made through this client carries the user's JWT, so RLS applies
 * (ARCHITECTURE.md §15). This is the only client the application should use.
 * There is deliberately no service_role client anywhere in `src/`: service_role
 * bypasses RLS, and onboarding — the one flow that acts before a user has a
 * role — goes through SECURITY DEFINER functions instead (see 0011).
 */
export function supabaseServer() {
  const cookieStore = cookies();

  const env = requireSupabaseEnv();

  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}
