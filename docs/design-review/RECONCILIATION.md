# Design reconciliation with `plum-quotes`

_17 September 2026 — for review when you're back._

You asked me to line this repo up with the other one now that its deployed
layout is where you want it, and to fix the time zone while I was in there.
Here is everything that changed and why. Nothing below alters the data model or
any permission; it is chrome, formatting and one database setting.

The reference I read is `adityabagarka/plum-quotes` at `bf5d2ef` — specifically
`src/app/globals.css` (the design tokens), `src/components/ds/*` (the shared
controls), `src/components/layout/AppHeader.tsx`, `src/components/wizard/*` and
the comparison ledger in `src/app/deals/[id]/quote/`.

---

## 1. The short version

| What                          | Before                                                   | Now                                                                                     |
| ----------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Fonts                         | Georgia and system-ui (placeholders)                     | Newsreader and Hanken Grotesk, self-hosted — the same substitutes the deployed app uses |
| Colour values                 | Seven tokens had drifted by a shade                      | Identical to the other repo, plus our green for enhancements                            |
| Design tokens                 | Colours only                                             | The full scale: type, spacing, weights, tracking, radius, shadow, easing                |
| Header                        | Logo + `you@plum.com · Admin` in grey                    | Logo, the deal you're in, then you as an initialled disc with name and role             |
| Step bar                      | Six boxed tabs                                           | Numbered circles joined by a hairline                                                   |
| Step footer                   | Rule stopped at the page column                          | Rule runs the full width of the window                                                  |
| Summary block                 | Roomy; full-height column dividers                       | Tightened; dividers only as tall as the figures they separate                           |
| Terms table                   | Scrolled sideways only — header row never actually froze | Bounded both ways; header row and benefit column both stay put                          |
| Section headings in the table | Bold serif on a tan band                                 | Quiet uppercase red, as everywhere else in the system                                   |
| Dates and times               | Server clock, which is GMT                               | India, everywhere, with tests proving it                                                |

---

## 2. Time zone — the one that was a real bug

We were formatting dates and counting days in whatever zone the server runs in,
and every machine involved (Vercel, Postgres, CI) runs on GMT. India is 5½
hours ahead, so **between 6:30pm and midnight our time the server still thinks
it is yesterday.**

Two things were wrong because of it:

- An activity entry written at 11pm would have been filed under the previous
  date. On an audit trail, that is an entry appearing to happen before
  something it actually followed.
- The countdown on the summary block would read one day longer than it is —
  every evening. A policy starting tomorrow would say "2 days".

What I did:

- `src/lib/format.ts` now pins `Asia/Kolkata` for every date and time it
  renders, and reduces both sides to a _calendar day in India_ before counting
  days. It also pins `en-IN`, so the clock is 12-hour and the digit grouping is
  lakhs — the app no longer mixes two conventions on one screen.
- Three places that were formatting dates by hand (the access queue, the
  company-age hint, the activity timeline) now go through those helpers, so
  there is one place to change and nowhere to forget.
- `supabase/migrations/0025_india_time_zone.sql` sets the database's own
  session zone to India. **No stored data changes** — every timestamp column is
  `timestamptz`, which records an absolute moment, not a wall clock. What
  changes is what you see when you read the audit trail directly in Supabase,
  and what date arithmetic in future SQL will assume.
- `npm run test:time` runs the whole set of date assertions **twice**, once
  pretending to be in GMT and once in India, and requires the same answer both
  times. A helper that quietly reads the machine's clock fails the GMT run.
  Wired into the checks that already run on every push.

Verified against a real Postgres locally: all 25 migrations apply, and a fresh
connection reports `Asia/Kolkata`.

---

## 3. Fonts

The other repo self-hosts Newsreader (standing in for GT Alpina) and Hanken
Grotesk (standing in for Passenger Sans) through Next's font pipeline. This repo
had placeholder stacks that fell through to Georgia and whatever sans the
viewer's machine happened to have — so the two apps genuinely did not look alike,
and neither looked like the design system.

Both are now loaded the same way. They are downloaded once when the site is
built and served from our own address, which means no request to Google on any
page view — worth having on an internal tool that will hold medical data — and
means a change at Google's end cannot alter how a rendered quote looks.

## 4. Colour and the rest of the token set

Seven values had drifted: the two deeper creams, both reds used on hover and
press, both foreground tints, and the softer hairline. Each was off by a shade
— invisible on one screen, but enough that the two apps looked subtly unalike
side by side. They are now character-for-character the same.

I also brought across the parts of the system this repo never had: the type
scale, the spacing scale, weights, letter-spacing, radii, shadows and the easing
curve. The stylesheet now names those rather than repeating numbers, so a change
to the system is a change in one place.

**On more colours than red:** the system does give red all the emphasis work,
and the other repo holds that line strictly. Our one deliberate exception
stays — the green for an enhancement against the red for a restriction, because
those move price in opposite directions and one colour cannot say which way.
Colour never carries it alone: every marked cell also has an arrow and a word,
which matters for anyone who cannot tell the two apart and for the Excel export,
where a fill may not survive. I did not widen the palette further; if you want
more variation later, the severity scale (blush → pink → coral → red) is the
system's own answer and is already wired up.

## 5. The terms comparison — yes, we should use their layout

Short answer to your question: yes, and it is done. Their comparison does one
thing ours did not, and it turned out to be hiding a bug.

Their whole ledger is **one grid inside one box that scrolls in both
directions**. Ours scrolled sideways inside a box but downwards with the page.
That matters because a "frozen" row or column only stays frozen inside the box
that scrolls — so our header row had nothing to freeze against and the option
names simply scrolled away. On a table whose entire job is reading a value
against the right option, that is the one failure that matters. Fixed: the
header row, the benefit column and the corner where they meet all stay put now,
and the table is capped in height so the footer and the policy panel beside it
stay on screen while you read.

I also took their treatment of section headings — quiet uppercase red on the
plain cream field — over our bold serif on a tan band. The band was louder than
the information warrants: in a table where the meaningful marks are the changed
cells, a heavy heading competes with them for the same attention. The caret and
the "8 benefits · 3 changed" count stay, because unlike theirs ours collapse and
a click target should look like one.

Everything you asked for on this table is untouched: sections collapse, options
are columns numbered from 1, Option 1 is the expiring terms, names are
renameable, **every option shows the full detailed term** rather than "same as
expiring", changed cells are marked by fill, enhancements green, restrictions
red.

## 6. Summary block

- Tightened: padding, the gap between the two halves, and the row spacing all
  came in a notch.
- The three figures on the right now hang from a common top edge, so their
  labels and figures line up across all three regardless of the countdown chip
  under the third.
- **The dividers between them no longer run the full height of the box.** They
  are drawn as short rules exactly as tall as the label-and-figure pair they
  separate, which is what you were seeing as too long.
- It already appears on all six steps — one `DealShell` component renders it,
  so the steps cannot drift apart. Confirmed rather than changed.

## 7. Header and footer

The header now follows theirs: logo on the left, then the deal you are looking
at, and on the right your initials in a disc with your name and role beneath.
It used to print your email address and role as one grey line. An email address
is an identifier, not a name, and running the role into it made the one fact
that changes what you can do read as part of the address.

The footer keeps your rule — back at the far left, forward at the far right —
but now takes their full-bleed hairline: the rule runs the width of the window
while the buttons stay in the page column. Same device at the top of the page,
so a screen is bracketed by a matching line top and bottom. The step bar became
numbered circles joined by a hairline, which is what they use; the connector
makes the sequence explicit where abutting boxes only implied it.

One stale rule from the old tab-style bar was still landing on locked steps and
pushing step 6 twelve pixels below the other five — found by measuring the
rendered page rather than by eye. Gone.

---

## What I did not do

- No change to the data model, permissions or RLS.
- No new palette beyond the enhancement green that was already there.
- The screens that are still unbuilt (policy upload, member roster and its
  deviation checks, claims, RFQ assembly) are unchanged — they will inherit all
  of this from `DealShell` and the stylesheet when they are built.

## Where to look

Re-rendered screenshots are in `docs/design-review/`: `07-company-step.png` for
the header, summary and footer; `05-terms-built.png` for the comparison table;
`06-deal-built.png` and `08-renewal-tint.png` for the rest.
