import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/db/server';

/**
 * Signs out and returns to the sign-in page.
 *
 * A POST, not a link: a GET would let any page on the internet sign a user out
 * by embedding an image pointing here, and browsers pre-fetch links.
 */
export async function POST(request: NextRequest) {
  const supabase = supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/sign-in', request.url), { status: 303 });
}
