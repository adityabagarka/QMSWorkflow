import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { MISSING_ENV_MESSAGE, supabaseEnv } from '@/lib/db/env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Deliberately does no authorisation: the boundary is RLS (§15), and the page
 * helpers handle redirects. Middleware that also made access decisions would be
 * a second, divergent copy of the permission model.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Middleware runs on every request, so throwing here takes the whole site
  // down with an opaque MIDDLEWARE_INVOCATION_FAILED and no clue as to why —
  // which is exactly what a misconfigured environment variable used to cause.
  // Pass the request through instead: the page itself then renders a readable
  // explanation, and only sign-in is actually broken.
  const env = supabaseEnv();
  if (!env) {
    console.error(`[middleware] ${MISSING_ENV_MESSAGE}`);
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: CookieToSet[]) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
