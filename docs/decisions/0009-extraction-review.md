# 0009 — Designing the extraction review so it is not skipped

**Status:** accepted (design)
**Relates to:** ARCHITECTURE.md §8, §14 screen 3; ADR 0008

## The problem

Policy terms are read by a model and corrected by an RM. The correction step is
what stops a misread term reaching the RFQ.

A review that is easy to rubber-stamp is **worse than no review**, because it
launders a bad extraction into the RFQ with someone's name against it. The
insurer then quotes against terms nobody actually checked, and the query that
follows arrives days later — which is the exact failure this system exists to
remove.

So the review has to be designed against skipping, not merely designed for
correcting. Five decisions follow from that.

## 1. Nothing arrives pre-approved

Extracted values land as **proposed**, not as filled-in fields. `policy_terms`
carries `review_status`, and until a human acts on a term its status is
`proposed` — visibly unreviewed on screen, and excluded from anything
downstream.

The alternative — showing extracted values in a form that looks complete — makes
"do nothing" indistinguishable from "I checked this". The database should not be
able to represent that ambiguity.

## 2. Least-confident first, not document order

The review screen sorts by extraction confidence ascending. The fields most
likely to be wrong are seen first, while attention is freshest.

Document order does the opposite: it front-loads the easy header fields, so by
the time the reader reaches an ambiguous room-rent clause they are twenty fields
into a rhythm of agreeing.

## 3. The source sits beside the field

§14 already specifies a side-by-side PDF and extracted fields. The point is that
a reviewer checks against the document rather than against their memory of what
these policies usually say — which is precisely the assumption that misses the
unusual term.

## 4. Confirmation is per section, not one button

Terms are confirmed in the eight `benefit_catalogue` sections. There is no
"approve all".

A single button is an invitation: one click, and 58 fields carry a reviewer's
name. Eight deliberate acts are not much slower for an honest reviewer and are
considerably more annoying for a careless one, which is the intended asymmetry.

## 5. The gate is structural

RFQ dispatch is blocked until **every** benefit in the catalogue has been
decided. Not a warning, not a nudge — the action is unavailable, and the screen
says which sections are outstanding.

Completeness is coverage, not absence of objection. The first version of this
gate asked "is any existing term still proposed?", which is vacuously false when
nothing has been entered — so a policy with no terms at all reported itself
ready. A gate that opens on precisely the case it exists to catch is worse than
no gate, because it is trusted. Fixed in migration 0020 and asserted since.

A benefit the policy does not mention is still a decision. "Not covered" is an
answer, and it is one the insurer needs.

§7 already establishes that dispatch cannot skip the compliance review gate.
This is the same principle one step earlier.

## What gets recorded

`policy_terms` gains, per term:

- `review_status` — `proposed`, `confirmed` (extraction was right) or
  `corrected` (a human changed it)
- `reviewed_by` / `reviewed_at` — who, when
- `extraction_confidence` — what the model claimed, kept so that confidence can
  be measured against outcomes rather than trusted

`confirmed` and `corrected` are deliberately distinct. Collapsing them into
"reviewed" would lose the measurement that matters: a model whose values are
always corrected is not working, and one whose values are always confirmed may
mean either that it is excellent or that nobody is really looking. Those need to
be tellable apart.

Every correction also appends to `policy_extraction_edits` (§8), which is the
fine-tuning and evaluation signal and is never overwritten.

## What this does not do

It cannot stop someone clicking confirm without reading. Nothing can. What it
does is remove every path where a term reaches the RFQ _without_ someone
deciding it should — no defaults, no bulk action, no dispatch while anything is
outstanding.

The residual risk is deliberate inattention rather than accidental omission, and
the record shows who to ask.
