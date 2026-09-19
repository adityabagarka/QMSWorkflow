import type { Metadata } from 'next';
import { Newsreader, Hanken_Grotesk } from 'next/font/google';
import '@/styles/plum.css';

/*
 * Substitutes for Plum's licensed brand fonts, matching plum-quotes exactly:
 * Newsreader stands in for GT Alpina, Hanken Grotesk for Passenger Sans.
 *
 * Self-hosted through next/font rather than a <link> to Google Fonts. next/font
 * downloads the files at build time and serves them from this app's own origin,
 * which removes a third-party request from every page load and, more to the
 * point here, removes a third-party from the request path of an internal tool
 * that will hold medical data. It also fixes the font files at build time, so a
 * Google-side change cannot alter how a rendered quote looks.
 *
 * The CSS variables are what src/styles/plum.css points --font-display and
 * --font-sans at; nothing else in the app names a typeface.
 */
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['300', '400', '500', '600', '700'],
});

const hankenGrotesk = Hanken_Grotesk({
  variable: '--font-hanken',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Quote Management',
  description: 'Internal quote management for group insurance deals.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${newsreader.variable} ${hankenGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
