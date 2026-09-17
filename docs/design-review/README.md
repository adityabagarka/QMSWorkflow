# Design review

`render.mjs` screenshots a page with the image's pinned Chromium, so a layout
can be looked at without deploying. The HTML files here link the real
stylesheet, `src/styles/plum.css` — they are a way of seeing the built styles
with representative content, not a second implementation to keep in step.

    node render.mjs 06-deal-built.html

## Decisions this review settled

**The deal page is a hybrid.** A checklist of the six stages is the deal's home,
because a rollover is picked up and put down over weeks and progress has to be
legible at rest. Step navigation with back/next lives inside a stage, where the
work is sequential.

**Cover start, not expiry.** The date a deal turns on is the inception of the
policy being quoted. Screens lead with it and count down to it.
`cases.policy_expiry_date` remains, because §11's reminder cascade keys off when
the current programme ends, but it is no longer what anyone reads first.

**Premiums exclude GST, said once,** against the figure, by the component that
renders it. `GST_NOTE` in `src/lib/format.ts` exists so there is one place to
change it and no temptation to repeat it.

**No helper text explaining the system to itself.** The row-level security
model, the phase numbering and the storage layout are implementation. A user
needs their deals listed.

## The terms grid

**One CSS grid for the whole table.** Columns are declared once on the
container; sections span all of them. A grid per section would drift as sections
open and close, and a value read against the wrong column means an insurer
quoting the wrong cover.

**Sections are unmistakably not terms**: bold serif at 18px on the warm band,
against 13.5px sans on cream-deep for the rows beneath. The rows stay quiet on
purpose — highlighting each one would leave nothing to distinguish.

**Options are columns, numbered from 1.** Option 1 is the expiring terms
unchanged and stores no rows at all, so it cannot drift from them. Options 2
onwards each override one or more benefits, and an override is exactly a stored
row — which means "changed" needs no diffing, and correcting an expiring term
flows into every option that had not overridden it.

**Names are editable.** A generated name stops describing an option as soon as
several terms move.

**A changed cell is marked by fill alone.** The earlier red rule said the same
thing twice and made the grid look busier than the information warrants.
