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
    2. Deal setup       the company, and the programme it is rolling over
    3. Demography       what the member data says, and where it deviates
    4. Claims           what the history says, and what it implies
    5. Terms            the policy terms, and the options built from them
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

### 1. Step 1 never blocks; step 6 does

Documents do not arrive together. The policy copy usually comes first; an
insurer's claims MIS can take weeks. A step 1 that demanded all four would block
every deal on its slowest document, which is precisely the friction this change
exists to remove.

So step 1 accepts whatever exists and always lets the user continue, and a file
can be added later from any step. "Nothing uploaded yet" is a state the flow
handles, not an error it refuses.

All four are nonetheless **mandatory to dispatch an RFQ**. An insurer cannot
quote a programme whose member data or claims history nobody has seen, so the
requirement is real — it simply belongs at the point where the obligation
actually bites. The dispatch gate at step 6 refuses while any document is
missing, and names which.

This is the same gate pattern as the term review (migrations 0020 and 0026): the
thing that must be true is checked where it matters, not used as a turnstile at
the entrance.

### 2. Extraction runs behind the user, and no wait is manufactured

A sixty-page policy PDF and a claims dump of tens of thousands of rows are not a
two-second wait. Upload, then move on; extraction proceeds in the background.

The deliberate alternative — hold the user at step 1 until everything has parsed,
with something friendly on screen — was considered and rejected, because the
timings make it unnecessary. The three spreadsheets parse in seconds. The policy
copy is the slow one, and the policy feeds step 5, the **last** review step
before the RFQ. Everything between upload and there — deal setup, demography,
claims reconciliation — is several minutes of genuine attention.

So the extraction happens during work the user was going to do anyway. A wait at
step 1 would spend that time twice.

The one case that needs a waiting state is someone who jumps straight to terms
before the policy has finished. That step, and only that step, shows that it is
still reading.

This needs background work with durable state. **The orchestrator is an open
question in §18 and is not decided here** — at this volume a job row and polling
is sufficient, and adopting Temporal is a separate decision to be taken on its
own merits rather than smuggled in through this one.

### 3. Only one of the four documents needs a model

The policy copy is prose and needs the LLM (ADR 0008). The member roster, the
claims dump and the MIS summary are spreadsheets: they need a parser and a
column mapper, which are ordinary code.

This matters because of §18.2. The data-processing agreement covering PHI is not
signed, so the policy extraction path cannot be pointed at real data — but three
of the four documents were never going to need it.

**Building is not blocked; going live is.** The code paths are built now against
synthetic files, which is what CLAUDE.md prescribes in any case: no real PII or
PHI in this environment, at any milestone, in any seed script, fixture or test.
What the DPA gates is sending a real policy PDF to a third-party model, and that
belongs on the pre-release checklist as a **hard gate before go-live**, not as an
item that can drift. Recorded here so the distinction does not get lost: the
absence of a DPA is not a reason to delay the build, and its absence at launch
is a reason to delay the launch.

### 4. Deal setup, not company profile — and the registry beats the policy

Step 2 carries more than the company. It holds the incumbent insurer and broker,
the expiring premium and the cover start date, none of which describe the
company. Calling it "company profile" and then adding a separate step for the
programme would split one act of setting up a deal across two screens.

It is one step with sections:

- **The company** — GSTIN, legal name, constitution, industry, principal place
  of business, date of incorporation.
- **The programme being rolled over** — incumbent insurer, incumbent broker,
  expiring premium, cover start.

**Cover start is derived, not asked.** It defaults to the expiring policy's
expiry date plus one day, which is what continuity means. It stays editable,
because cover does sometimes start later than the day after expiry — a
deliberate shift, or a gap the client accepted — and a derived field that cannot
be corrected is a field that will be wrong. The expiry date is captured and
stored; the start date is what every screen shows (the standing rule).

**Where the company and the policy disagree**, the GSTN record wins on legal
entity details — name, constitution, principal place of business — because it is
the authoritative registry and it is what the policy should have said. The
policy copy fills what GSTIN does not carry.

The GSTIN is itself usually printed on the policy copy, which makes it an
extraction target as well as an input: read it, look it up, and the two sources
verify each other. Verification against a GSTN API is a later phase; for now the
lookup is fixture-backed and the RM confirms the result.

**This implies a customer is an entity, not a column.** The intent that an
existing client is chosen from a search and the deal data captured against them
does not work while company details live on the case, as `cases.customer_name`
does today. A customer has many deals over time — this year's rollover, next
year's renewal — and the company section belongs to the customer while the
programme section belongs to the deal.

That is an additive schema change, and it is the same seam as the renewal flow
(see above): a renewal is a new deal against an existing customer with the
previous deal's data already known. **Worth settling before this is built**, not
retrofitted after the screens exist.

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

### 6. Manual entry first is a supported path, not a fallback

A deal often starts before any document exists. An RM types what they know from
a phone call, runs a rough burn calculation, and decides whether the deal is
worth chasing — or gives the client a ballpark. The documents arrive afterwards.
That is how the work is actually done, and a tool that will not open until the
file lands is absent from the part of the job where the decision gets made.

So manual entry is a first-class way to fill any field, and a document arriving
later reconciles against it rather than being blocked or blocking.

**This is one mechanism, not two.** The temptation is to build a "manual mode"
and a "document mode", which doubles every screen and guarantees they drift.
Instead, the columns the extraction review already needs carry it:

| What happens               | `source` | `review_status` | Effect                          |
| -------------------------- | -------- | --------------- | ------------------------------- |
| RM types a value           | `manual` | `confirmed`     | A human decided it. It is real. |
| Document parsed, agrees    | —        | unchanged       | Corroboration recorded          |
| Document parsed, disagrees | —        | unchanged       | Queued as a candidate           |
| RM resolves the difference | either   | `corrected`     | Decision and evidence recorded  |

The rule that keeps this cheap: **a candidate never overwrites, it queues.** A
field holds its current value plus the history of what has been proposed against
it. Nothing a person decided is silently replaced by something a model read, and
nothing a model read is silently discarded either. That is append-only, which
§16 wants regardless.

A disagreement here is the same object as rule 5's: both values, the choice, who
made it, when. One reconciliation surface serves the MIS-versus-dump case and
the document-versus-typed case, because they are the same question.

### 7. An estimate must not be able to become a quote

A burn calculation over manually entered values is worth having — it is the
point of rule 6 — and it is an estimate. The difference has to be a property of
the data rather than a convention people remember.

So a figure computed from any input that is still unconfirmed is marked as an
estimate wherever it appears, and **cannot reach an RFQ or any customer-facing
page.** The same gate that refuses to dispatch without the documents refuses to
quote from unconfirmed inputs.

Without this, "back of the envelope" becomes "the number we quoted" by nothing
more than time passing, and the audit trail would show a figure with somebody's
name against it that nobody ever checked.

## Consequences

**New schema, when this is built.** A documents table that knows each file's
kind and extraction state; an extraction job record per document; a candidate
table holding proposed values against fields that already have one; a
reconciliation record carrying both figures and the decision, serving rule 5 and
rule 6 alike. A customers entity, per rule 4. `cases.current_phase` stays as it
is — the phase numbers move, the mechanism does not.

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

**Holding the user at step 1 until everything has parsed**, with a friendly
message on screen. Rejected on rule 2: the slowest document feeds the last step,
so the wait is avoidable entirely, and a manufactured one spends the user's time
twice. The instinct behind it — make the machine's time feel considerate — is
worth keeping for a wait that is genuinely unavoidable, such as an RFQ going out
to nine insurers.

**Treating manual entry as a fallback for when documents are missing.** Rejected
on rule 6: it is how a deal actually starts, and modelling it as a degraded path
would have meant a second set of screens and a second set of gates.

**Letting the document silently overwrite a typed value**, on the grounds that
the document is the source of truth. Rejected: it is true of the policy's terms
and false of everything a person knows that the file does not say, and either
way overwriting destroys the disagreement, which is the useful part.
