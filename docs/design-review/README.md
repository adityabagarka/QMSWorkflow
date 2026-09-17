# Design review — not production code

Static mockups for sign-off. Nothing here is wired to anything; `render.mjs`
screenshots them with the image's pinned Chromium. Delete once the decisions
land in `src/`.

## What the feedback changed

**Helper text that explained the implementation is gone.** "Your own deals, and
those of anyone reporting to you. A colleague at your own level cannot see
these" is a description of the row-level security model. A user does not need
the mechanism explained; they need their deals listed.

**Policy START date, everywhere.** The date that matters is when cover begins,
so the list and the deal page lead with "Cover starts" and a countdown, and the
expiring policy's own start date is a supporting fact. This wants a schema
change: `cases.policy_expiry_date` is the wrong field to be carrying.

**Premiums exclude GST, said once.** Each premium figure carries "excluding GST"
directly beneath it, at the value, and nowhere else. No repeated disclaimers.

**Removed:** the "ROLLOVER DEAL" eyebrow (every deal is one), the "Phase" row
that repeated the tracker directly above it, and the "Bringing in the expiring
programme" section with its explanatory paragraph.

**Moved:** owner out of the first rank of facts; "back to deals" to a breadcrumb
at the top where it belongs rather than stranded at the bottom; activity to a
sidebar rather than a full-width section competing with the work.

**Company identity is one block:** name large, constitution and industry as
subtext beneath it, cover start date and countdown on the right.

## The two deal-page options

Both replace the flat phase tracker with something navigable.

**A — wizard-led.** Numbered steps across the top, one step's work in the main
column, explicit back/next. Closest to the `plum-quotes` flow. Best when the
work is genuinely sequential and the RM is completing a deal in one sitting.

**B — overview and checklist.** The same six stages as rows, each showing its
own state, with the current one carrying the action. Best when a deal is picked
up and put down over weeks — which is what a rollover actually is — because
progress is legible at rest rather than only while moving through it.

They are not exclusive: B works as the deal's home, with A's back/next
navigation inside each stage once you are in it.
