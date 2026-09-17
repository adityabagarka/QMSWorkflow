/**
 * The two Supabase settings the browser-facing app needs.
 *
 * Both are `NEXT_PUBLIC_*`, which means Next.js inlines them into the build.
 * That has a consequence worth stating plainly, because it is easy to get
 * wrong when configuring a host: the build must be able to READ them. On
 * Vercel they must therefore be stored as plain configuration, not as a
 * write-only secret. A write-only secret leaves them `undefined` at runtime.
 *
 * Neither value is sensitive. The anon key is designed to be shipped to every
 * visitor's browser; what protects the data is row-level security in the
 * database (§15), not the secrecy of this key.
 */
export type SupabaseEnv = { url: string; anonKey: string };

export const MISSING_ENV_MESSAGE =
  'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not readable at runtime. ' +
  'On Vercel, add them as Config (not Secret) — a Secret is write-only, so the build cannot ' +
  'inline it and the value arrives undefined. Then redeploy: environment variable changes do ' +
  'not apply to an existing deployment. See docs/SETUP.md stage 5b.';

/** Returns the settings, or null when either is missing or blank. */
export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/** Returns the settings, or throws with an explanation of how to fix it. */
export function requireSupabaseEnv(): SupabaseEnv {
  const env = supabaseEnv();
  if (!env) throw new Error(MISSING_ENV_MESSAGE);
  return env;
}
