/**
 * The slim cream header the design system calls for: small plum logo left,
 * lightweight sans detail right, hairline rule beneath (docs/plum-design.md).
 */

/**
 * INTERIM: the logo is hotlinked from Plum's own CDN rather than served from
 * this app.
 *
 * It should be vendored into `public/` instead — an external URL means the
 * branding breaks if that path ever moves, and it makes every page load wait on
 * a third host. Kept remote only because this build environment has no network
 * access to plumhq.com, so the file could not be downloaded and committed.
 *
 * To finish the job: save the SVG to `public/plum-logo.svg` and change `src`
 * below to `/plum-logo.svg`. Nothing else needs to change.
 */
const LOGO_SRC = 'https://app.plumhq.com/images/plum_rebranded_logo.svg';

export function Masthead({ meta }: { meta?: string }) {
  return (
    <header className="masthead">
      {/* Plain <img> rather than next/image: the asset is an SVG, which Next's
          optimiser passes through untouched anyway, and this avoids configuring
          a remote pattern for a URL that is meant to become local. The alt text
          carries the wordmark if the image ever fails to load. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="masthead__logo" src={LOGO_SRC} alt="Plum" width={72} height={24} />
      {meta ? <span className="masthead__meta">{meta}</span> : null}
    </header>
  );
}
