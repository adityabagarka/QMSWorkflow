# Design review

`render.mjs` screenshots a page with the image's pinned Chromium, so a layout
can be looked at without deploying. The HTML files here link the real
stylesheet, `src/styles/plum.css` — they are a way of seeing the built styles
with representative content, not a second implementation to keep in step.

    node render.mjs 06-deal-built.html

## Decisions this review settled

**The deal page is a wizard.** Six steps across the top, each a link, plus
back/next at the foot of the step. Returning to review or edit an earlier step
is a click on its number rather than a retraced path, so the step bar does the
job the checklist would have done. Steps the deal has not reached yet are inert.

**Every step has the same two columns:** the work on the left with room to
breathe, reference material on the right in a narrower column. Documents and
activity on most steps; on the terms step, the policy itself — checking a clause
should not mean leaving the screen and coming back.

One `DealShell` component renders the header, the step bar and both columns, so
the steps cannot drift apart. A wizard whose chrome moves between steps is just
a set of pages.

**Cover start, not expiry.** The date a deal turns on is the inception of the
policy being quoted. Screens lead with it and count down to it.
`cases.policy_expiry_date` remains, because §11's reminder cascade keys off when
the current programme ends, but it is no longer what anyone reads first.

**Premiums exclude GST, said once.** `GST_INPUT_HINT` in `src/lib/format.ts` is
shown where somebody TYPES a premium, and once on the comparison table. It is
not repeated wherever a figure is displayed — a caption on every figure trains
people to stop reading it.

**Every date and time is India time,** pinned in `src/lib/format.ts` and in the
database (migration 0025). The machines all run on GMT, which is 5½ hours
behind; see `RECONCILIATION.md` §2.

**The design language is kept in step with `plum-quotes`.** Tokens, fonts,
header, step bar, footer and the comparison table all follow the deployed app —
see `RECONCILIATION.md` for what moved and why.

**No helper text explaining the system to itself.** The row-level security
model, the phase numbering and the storage layout are implementation. A user
needs their deals listed.

## The terms grid

**One CSS grid for the whole table.** Columns are declared once on the
container; sections span all of them. A grid per section would drift as sections
open and close, and a value read against the wrong column means an insurer
quoting the wrong cover.

**One bounded scroller, both axes.** A frozen row or column only holds inside
the box that scrolls, so the header row, the benefit column and the corner where
they meet all live in one capped-height container. Before this the table
scrolled sideways in its box but downwards with the page, and the header row
quietly scrolled away.

**Sections read as eyebrows, not banners**: uppercase red at 11px on plain
cream, the same device that opens every other section in the system. A heavy
band competed with the changed cells for the same attention. The caret and the
count stay, because these sections collapse and a click target needs to look
like one.

**Options are columns, numbered from 1.** Option 1 is the expiring terms
unchanged and stores no rows at all, so it cannot drift from them. Options 2
onwards each override one or more benefits, and an override is exactly a stored
row — which means "changed" needs no diffing, and correcting an expiring term
flows into every option that had not overridden it.

**Names are editable.** A generated name stops describing an option as soon as
several terms move.

**A changed cell is marked by fill alone.** The earlier red rule said the same
thing twice and made the grid look busier than the information warrants.
