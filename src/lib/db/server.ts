import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
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
    },
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}
