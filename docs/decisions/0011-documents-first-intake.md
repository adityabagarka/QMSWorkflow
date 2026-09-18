# 0011 — Documents first: the wizard as a review pipeline

**Status:** accepted (design; not yet implemented)
**Relates to:** ARCHITECTURE.md §8, §9, §11, §14, §17, §18; ADR 0007, 0008, 0009

## The problem

The wizard as built asks the RM to type what a document already says, then
attach that document as evidence. The company profile, the expiring policy's
header, the member counts and the claims history are all transcribed by hand
from files the RM is holding at the time.

Two costs. The obvious one is effort: a person acting as an OCR engine for a
PDF they are about to upload anyway. The less obvious one is adoption — a tool
that front-loads twenty minutes of typing before it shows anything useful does
not get opened for the next deal, and a quoting desk that is not used is not a
quoting desk.

There is also a structural cost. Getting files out of a client's inbox is the
one genuinely irreversible step in a rollover, and the current flow spreads that
ask across four screens. A deal can stall four separate times on the same
underlying problem.

## The decision

Collect every document up front, read them, and make each subsequent step a
**confirmation of what was read** rather than a form to fill.

    1. Documents        policy copy, member data, claims dump, claims MIS
    2. Company profile  who we are quoting for, and what they have today
    3. Demography       what the member data says, and where it deviates
    4. Claims           what the history says, and what it implies
    5. Terms            the expiring terms, and the options built from them
    6. RFQ              assembly and dispatch

This is not a reordering. It changes what the wizard _is_. The database already
models extraction as a proposal that a human decides on — `policy_terms` carries
`source`, `review_status`, `reviewed_by` and `reviewed_at`, and the gate in
migrations 0020 and 0026 refuses to open until every benefit has been decided.
Today that machinery serves one screen. Under this design it is the spine of the
whole flow, and every step has the same shape: here is what we read, here is
where it came from, tell us if it is wrong.

**Effort moves; accountability does not.** Nothing arrives pre-approved (ADR
0009 §1), and that holds for all four documents, not just the policy.

## Why this matters beyond convenience

The population layer becomes a seam. Once a step is fed by "whatever we know
about this client" rather than "whatever was typed", the source of that
knowledge is a field, not a different flow:

| Source         | Rollover               | Renewal                 |
| -------------- | ---------------------- | ----------------------- |
| Member data    | uploaded roster        | our own member database |
| Expiring terms | the incumbent's policy | the policy we placed    |
| Claims history | insurer's dump         | our own claims records  |

The renewal flow then _is_ the rollover flow with step 1 already answered — same
screens, same review gates, same audit trail. Building it as a separate flow
later would mean two implementations of every confirmation screen, drifting.

This is the main reason to adopt the design now rather than when renewals are
built: retrofitting a source abstraction means touching every screen, and the
cost of designing for it up front is close to zero.

## Rules this design commits to

### 1. Step 1 never blocks

Documents do not arrive together. The policy copy usually comes first; an
insurer's claims MIS can take weeks. A step 1 that demands all four would block
every deal on its slowest document, which is precisely the friction this change
exists to remove.

So step 1 accepts whatever exists and always lets the user continue. The step
bar shows which steps are still waiting on a document, and a file can be added
later from any step. "Nothing uploaded yet" is a state the flow handles, not an
error it refuses.

### 2. Extraction runs behind the user, not in front of them

A sixty-page policy PDF and a claims dump of tens of thousands of rows are not a
two-second wait. Upload, then move on; extraction proceeds in the background and
a later step shows that it is still reading rather than showing a blank form.

This needs background work with durable state. **The orchestrator is an open
question in §18 and is not decided here** — at this volume a job row and polling
is sufficient, and adopting Temporal is a separate decision to be taken on its
own merits rather than smuggled in through this one.

### 3. Only one of the four documents needs a model

The policy copy is prose and needs the LLM (ADR 0008). The member roster, the
claims dump and the MIS summary are spreadsheets: they need a parser and a
column mapper, which are ordinary code.

This matters because of §18.2. The data-processing agreement covering PHI is not
signed, so the policy extraction path cannot run against real data — but three
of the four documents were never going to need it. The spreadsheet paths can be
built and run for real independently, and the design should not treat the whole
step as gated on the DPA.

The standing rule in CLAUDE.md applies throughout: **no real PII or PHI in this
environment at any milestone.** Every fixture and test file here is synthetic.

### 4. The company profile has two sources, and the registry wins

The GSTIN record and the policy copy both name the insured. Where they disagree
on legal entity details — name, constitution, principal place of business — the
GSTN record wins, because it is the authoritative registry and it is what the
policy should have said. The policy copy fills what GSTIN does not carry:
incumbent insurer, incumbent broker, expiring premium, cover dates.

This also settles where the old "expiring policy" step went. Its header fields
fold into the company profile, which now reads as "who we are quoting for and
what they have today". The policy's _terms_ remain at step 5.

### 5. A disagreement between the MIS and the dump is a decision, not a display

The claims MIS summary states figures — incurred claims ratio, utilisation, top
causes — that we can also compute from the raw dump. When the two disagree,
neither silently wins.

Both are shown, and **the RM must explicitly choose before the RFQ can be
built.** The discrepancy is held as a blocking decision in the same shape as the
term review gate: unresolved means not ready.

This is deliberate. A gap between what an insurer reports and what their own
data shows is frequently the most negotiable thing in the file, and a tool that
quietly picked one number would discard the single most useful signal on the
screen. Per §9 and §11, the resolution records its evidence — both figures, the
choice, who made it and when — not merely a status flag.

## Consequences

**New schema, when this is built.** A documents table that knows each file's
kind and extraction state; an extraction job record per document; a
reconciliation record for MIS-versus-computed discrepancies carrying both
figures and the decision. `cases.current_phase` stays as it is — the phase
numbers move, the mechanism does not.

**`benefit_catalogue` remains the single schema** for extraction targets, SKU
coverage, RFQ terms and the comparison table (CLAUDE.md). Nothing in this design
introduces a second field list; the member and claims documents populate their
own entities, not a parallel benefit vocabulary.

**The review gate generalises.** `app.policy_review_complete` currently answers
for policy terms. The same question — is every decision in this domain made —
will need answering for demography deviations and for claims reconciliation
before the RFQ assembles. Worth building as one pattern rather than three.

**Not started.** M0 is the current milestone and is not yet signed off. This ADR
records the design so it is not re-litigated later; implementation waits for M0
to be confirmed working, per CLAUDE.md.

## What was considered and rejected

**Keeping data entry, adding extraction as an assist.** Pre-filling the existing
forms from documents would have been a smaller change. Rejected because it makes
"extracted and unchecked" indistinguishable from "typed and meant" on screen —
the exact ambiguity ADR 0009 §1 exists to prevent.

**Requiring all four documents at step 1.** Simpler to build and to explain.
Rejected on rule 1: it blocks every deal on its slowest document.

**Defaulting to our computed figure when the MIS disagrees.** Defensible, and my
initial recommendation. Rejected in favour of an explicit choice, because the
discrepancy is a negotiating position rather than a data-quality problem, and a
default would train people to stop looking at it.
