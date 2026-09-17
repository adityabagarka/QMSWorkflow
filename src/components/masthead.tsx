'use client';

import { useState } from 'react';

/**
 * The slim cream header the design system calls for: small plum logo left,
 * lightweight sans detail right, hairline rule beneath (docs/plum-design.md).
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

export function Masthead({ meta }: { meta?: string }) {
  const [logoFailed, setLogoFailed] = useState(false);

  return (
    <header className="masthead">
      {logoFailed ? (
        <span className="masthead__mark">Plum</span>
      ) : (
        /* Plain <img> rather than next/image: the asset is an SVG, which Next's
           optimiser passes through untouched anyway, and this avoids declaring
           a remote pattern for one logo. */
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
      {meta ? <span className="masthead__meta">{meta}</span> : null}
    </header>
  );
}
