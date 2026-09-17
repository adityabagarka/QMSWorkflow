'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ROLE_LABELS, isApprover, type Role } from '@/lib/auth/roles';

/**
 * The slim cream header every page shares.
 *
 * Restructured to match plum-quotes' AppHeader, because the two apps are meant
 * to feel like one product: logo on the left, optionally followed by the deal
 * being worked on; on the right the navigation an approver needs, then the
 * person, as an initialled disc with their name and role under it.
 *
 * What changed and why: the header used to print "aditya@plumhq.com · Admin" as
 * one grey line. An email address is an identifier, not a name — it is what you
 * type to log in, not what you are called — and running the role into the same
 * line made the one piece of information that changes what you can do read as
 * part of the address. Name and role now sit on their own lines, and the disc
 * gives the block something to anchor to at a glance.
 */

/**
 * The logo is loaded from Plum's own CDN rather than copied into this app.
 *
 * Deliberate: a rebrand or a logo tweak on plumhq.com reaches this app with no
 * deploy and nobody having to remember it exists. For an internal tool serving
 * one company, that is worth more than self-hosting.
 *
 * The cost is that the app's branding now depends on a URL it does not control,
 * and a rebrand is exactly the moment paths get renamed. So the fallback below
 * is not decoration: if the image ever fails to load, the header shows the
 * wordmark instead of an empty space, and the app keeps looking deliberate
 * rather than broken.
 */
const LOGO_SRC = 'https://app.plumhq.com/images/plum_rebranded_logo.svg';

export type MastheadUser = { name: string; email: string; role: Role | null };

/** "Aditya Bagarka" -> "AB"; falls back to the address when there is no name. */
function initials(user: MastheadUser): string {
  const source = user.name?.trim() || user.email;
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  return (words[0]?.[0] ?? '?').concat(words[1]?.[0] ?? '').toUpperCase();
}

export function Masthead({
  user,
  dealTitle,
  dealRef,
}: {
  /** Absent on the sign-in page, which is the one page with nobody signed in. */
  user?: MastheadUser;
  /** Shown beside the logo on a deal screen, so the header says where you are. */
  dealTitle?: string;
  dealRef?: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <header className="masthead">
      <Link className="masthead__left" href="/deals">
        {logoFailed ? (
          <span className="masthead__mark">Plum</span>
        ) : (
          /* Plain <img> rather than next/image: the asset is an SVG, which
             Next's optimiser passes through untouched anyway, and this avoids
             declaring a remote pattern for one logo. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            className="masthead__logo"
            src={LOGO_SRC}
            alt="Plum"
            width={72}
            height={24}
            onError={() => setLogoFailed(true)}
          />
        )}

        {dealTitle ? (
          <>
            <span className="masthead__divider" />
            <span className="masthead__deal">
              <span className="masthead__deal-name">{dealTitle}</span>
              {dealRef ? <span className="masthead__deal-ref">{dealRef}</span> : null}
            </span>
          </>
        ) : null}
      </Link>

      {user ? (
        <div className="masthead__right">
          {isApprover(user.role) ? (
            <Link className="masthead__nav" href="/admin/access-requests">
              team &amp; access
            </Link>
          ) : null}

          <div className="masthead__user">
            <span className="masthead__avatar" aria-hidden="true">
              {initials(user)}
            </span>
            <div>
              <div className="masthead__name">{user.name || user.email}</div>
              <div className="masthead__role">
                {user.role ? ROLE_LABELS[user.role] : 'No role yet'}
              </div>
              {/* Reachable from every signed-in page. Without it, anyone who
                  needs to check how their access looks after a change — or to
                  sign in as somebody else — has to clear cookies by hand. */}
              <form action="/auth/signout" method="post">
                <button className="masthead__signout" type="submit">
                  sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
