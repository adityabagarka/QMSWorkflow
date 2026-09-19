# ADR 0012 — Reading the policy copy

**Status:** accepted
**Date:** 2026-09-18
**Context:** ARCHITECTURE.md §8, §16, §18.2; ADR 0011 rule 3; CLAUDE.md (canonical schema discipline)

## The decision

The expiring policy copy is read by a model, which **proposes** the expiring
terms. Nothing it proposes counts until a person confirms or corrects it, and
every value it proposes carries the clause it was read from.

## What the model is given

**The text layer, with the insurer's filed wording removed.** Not the PDF.

A policy copy is mostly not about this deal. The filed wording — the standard
terms every insurer registers with IRDAI — is pages 15 to 55 of an ICICI
Lombard policy and 8 to 21 of a TATA AIG one, and none of it can be
negotiated, so none of it can be an expiring term. What a broker quotes
against is the schedule, the benefit tables and the endorsements.

Measured over fourteen readable policies from three insurers: **71% of pages
dropped**, and what remains is about 6,000 tokens of text per policy rather
than 26 rendered pages.

Two rules make the trim safe rather than merely cheap:

- **The boundary is a heading with a substantial section behind it**, not a
  mention of one. "Scan to Download Policy Wordings." is a TATA AIG page-one
  footer, and matching it cut a 21-page document to nothing. "Disclaimer" is a
  real boundary for that same policy and a paragraph on page 3 of a four-page
  Bajaj one — so a heading with almost nothing after it is not a boundary.
- **Bajaj attaches no filed wording at all.** Their policies are three to five
  pages. "No boundary found" therefore means send everything, never send
  nothing.

Page markers survive into the text, so a term's evidence still names the page
in the original file and the panel can be taken there.

## Why a model at all

It is the only document in the flow that needs one. The roster and the claims
dump are tables: a parser reads them exactly, and where it cannot, it says which
column it could not match and asks. A policy copy is prose, written differently
by every insurer, and saying what the room rent limit is means reading a
sentence — sometimes an endorsement that overrides the schedule forty pages
earlier.

The alternative is what the flow does today: an RM reads sixty pages and types
fifty-eight values. That is the single largest piece of work left in the wizard,
and it is the work most likely to be done at speed on a Friday.

## The rules

### 1. Every value carries its evidence

`policy_terms.evidence_quote` and `evidence_page`, and the database refuses an
extracted term that has a value and no quote.

This is the rule the rest depend on. A reviewer looking at fifty-eight values
with no sources is not reviewing the policy, they are agreeing with the model —
and the confirmation they give is what an insurer later quotes against. With the
clause on screen, confirming a term is a thirty-second act of reading rather than
an act of faith. It is also what makes a disagreement arguable later: "the policy
says this, on page 12" survives a change of RM, and a status flag does not.

### 2. Absence is an answer

A benefit the policy does not mention comes back as _not stated_, never as a
market-standard value. On a rollover, "the expiring policy is silent on day care"
is exactly the thing an insurer asks about; a plausible guess in that cell is
worse than a blank, because a blank gets asked about and a guess does not.

### 3. The model proposes, a person reviews

Enforced by a trigger, not by the screen: an insert of an extracted term with any
review status but `proposed` is refused. The screen is where a rule is most
easily forgotten, and this is the rule that stops an estimate becoming a quote
(ADR 0011 rule 7).

`confirmed` and `corrected` stay distinct, as 0017 set them up, because that
difference is how the reader gets measured. Every correction is also appended to
`policy_extraction_edits`, which is the eval set.

### 4. A run never overwrites a review

Where a term has already been confirmed or corrected, a later run leaves it
alone and reports the disagreement instead. A review is a decision; a model
disagreeing with it is information, not grounds to undo it. The run's own
reading is kept whole in `policy_extractions.extracted_terms` either way, so
nothing is lost by not writing it.

This is ADR 0011 rule 6 — candidates queue, they do not overwrite — applied to
the one document a model reads.

### 5. It is a button, and it never blocks

Reading costs money and takes a minute, and the person who uploaded the policy
may not be the person who works the terms. So it runs when somebody asks, on the
screen where the result is used.

An environment with no `ANTHROPIC_API_KEY` is a supported state, not a broken
one: the panel says the terms are entered by hand and every other part of the
step behaves exactly as it did. That matters because of the next section.

## The DPA, and why this ships anyway

§18.2 — the LLM provider and the data-processing agreement for PHI/PII — is
open, and ARCHITECTURE.md flags it as blocking M2 policy extraction. This was put
to the user, who decided to build now and mark the DPA as a release-checklist
item rather than a build blocker.

What that means concretely:

- **The code is inert without a key.** No key, no calls, no data leaves.
- **The policy copy is the only document sent.** The roster and the claims dump
  are the files with member-level PHI in them, and they are read locally by
  parsers that never call out. A policy copy names the policyholder and its
  insurer; it is not a list of people and their conditions.
- **Nothing in this repo ever sends real data,** per the hard rule in CLAUDE.md.
  Every fixture is synthetic.

Turning the key on in a production environment remains gated on §16's compliance
review. That gate is a deployment decision, and it is now the only thing between
this code and use — which is the right shape for it.

## What was not chosen

**Citations instead of quotes.** The API can return citations that point into a
document block, which is stronger evidence than a quote the model reproduces.
Two things rule it out: it is incompatible with a schema-constrained response,
and the schema is what keeps every value tied to a `benefit_key`; and it needs
the PDF sent as a document, which is the thing the trim above exists to avoid.
A quote the reviewer can find in the panel beside them, on a page the term
names, was judged the better trade.

**Sending the PDF.** Simpler, and it would let the model see tables as laid out
rather than as flattened text. Rejected on cost once the trim was measured: a
schedule is a few thousand tokens of text against tens of rendered pages, and
the layout that matters — two-column label/value tables — survives the text
extraction because items are joined by position rather than with spaces.

**Extracting on upload.** Rejected with the wait itself: ADR 0011 rule 2 says the
user is never made to watch a progress bar. Reading on demand on the terms step
keeps that true without a queue.

**A second field list for extraction targets.** The catalogue is passed into the
reader from `benefit_catalogue`. A list hard-coded in the prompt would be the
exact duplicate CLAUDE.md forbids, and would drift the first time a benefit is
added to the workbook.
