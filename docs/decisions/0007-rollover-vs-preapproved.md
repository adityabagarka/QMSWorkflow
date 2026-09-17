# 0007 — How rollover differs from the pre-approved plan workflow

**Status:** accepted (design), partly open — see "Open questions"
**Relates to:** ARCHITECTURE.md §6, §9, §11; `plum-quotes` repository

The existing quote workflow (`adityabagarka/plum-quotes`) prices a customer into
a **pre-approved plan**. This system quotes a **bespoke plan built around what
the customer already has**. That single difference inverts several rules, and
most of the mistakes available here come from carrying the old behaviour across.

## The inversion: flag, do not drop

|                               | Pre-approved workflow                | Rollover workflow                           |
| ----------------------------- | ------------------------------------ | ------------------------------------------- |
| Eligibility comes from        | our SKU guardrails                   | the expiring policy's terms                 |
| A member outside the rules is | dropped from `rated_lives`           | kept, and flagged                           |
| Recorded in                   | `member_data_exclusions` (F-04)      | `member_deviations` (0015)                  |
| The output is                 | a filtered roster that fits the plan | a disclosed roster the plan is built around |

Two worked examples, both from the brief:

**Relationship.** The expiring policy covers employee, spouse and children, but
the roster contains parents. In the pre-approved flow those lives are dropped.
Here they are flagged: the insurer will not quote them as things stand, so the
RM must either remove them or carry them into the RFQ as an explicit ask.

**Age.** The policy's parent age limit is 80 and the roster contains a parent
aged 82. Dropping them would quietly shrink cover the customer already holds.
That life continues under the expiring policy; what is true is that a _new_ life
over 80 would not be admitted. So the deviation is disclosed to the insurer,
worded as a continuation.

Hence `member_deviations.is_continuation`: a life already on the policy is a
different request from a new life outside the limits, and the two must not read
the same way to an insurer.

A deviation is not an error. It is a disclosure, decided on by the RM and, when
accepted, carried into the RFQ pack. Sending an RFQ with undisclosed deviations
is what produces insurer queries and delayed quotes — the problem this system
exists to remove.

## Appetite is advisory, not a gate

§6 step 2 says an insurer marked `is_acceptable = 0` in `appetite_industry` or
`appetite_entity` is "excluded from plan matching entirely". That stands **for
plan matching**. It does not apply to the RFQ path.

A rollover case reaches an insurer's desk by email and a human decides. So
industry, entity type and location are **not hard gates** here. The system
should:

- surface where insurers commonly decline on industry, entity type or location,
  as guidance while the RM builds the deal
- still send the RFQ
- capture the insurer's actual decision, including a decline and its reason,
  rather than presuming the decline

`insurer_rfqs.decline_reason` already exists and is constrained so a declined
row cannot be saved without one.

This is why the deal-creation screen must NOT gate progress on entity type and
industry the way `plum-quotes` does.

## Which member-data rules still apply

`member_data_rules` is written for the pre-approved flow. Mapped across:

| Stage                             | Rollover treatment                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. Ingest (A-01…A-03)             | **Apply unchanged.** Required fields, empty rows, de-duplication — pure data sanity.                            |
| 2. Normalise (B-01…B-05)          | **Apply unchanged.** Name casing, gender and relationship vocabulary, date of birth, sum insured.               |
| 3. Derive (C-01…C-05)             | **Apply unchanged.** Note C-01's 365-day divisor is deliberate and must not be "fixed".                         |
| 4. Member eligibility (D-01…D-10) | **Do not drop anyone.** Re-expressed as deviation checks against policy terms — see below.                      |
| 5. Group validation (E-01…E-10)   | **Advisory.** Ratios, group size and outliers are warnings for the RM, not blocks. E-08/E-09 appetite as above. |
| 6. Output (F-01…F-04)             | Applies once terms are settled. F-04's exclusions log is joined by the deviations log.                          |

Stage 4 does not convert cleanly, which is the part worth deciding explicitly
rather than assuming. Proposed classification:

| Rule                                         | Proposed treatment                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| D-01 Employee minimum age                    | Deviation vs policy terms                                                                                                  |
| D-02 Employee/spouse maximum age             | Deviation vs `max_age_employee_spouse`                                                                                     |
| D-03 Child age window                        | Deviation vs `max_age_children`                                                                                            |
| D-04 Maximum children per employee           | Deviation vs policy terms                                                                                                  |
| D-05 Parent maximum age                      | Deviation vs `max_age_parents`                                                                                             |
| D-06 Parents where ESCP not offered          | Deviation vs `members_covered`                                                                                             |
| D-07 Maximum two parents, no cross-selection | **Mixed** — "no cross-selection" is a terms question, "at most two" is arguably data sanity                                |
| D-08 Dependent without an employee           | **Keep as a sanity error.** An orphan row corrupts the lives count and the ratio; it is malformed data, not a covered life |
| D-09 Bajaj pre-existing disease restriction  | Not applicable before the RFQ — it is quote wording, not an exclusion                                                      |
| D-10 Rated lives per insurer                 | Not applicable at upload; belongs to pricing                                                                               |

The terms being checked against are the first eight rows of
`benefit_catalogue` — `members_covered`, `lgbtq_cover`, `live_in_partner_cover`,
`siblings`, `age_band`, `max_age_employee_spouse`, `max_age_children`,
`max_age_parents` — which is a neat confirmation that §4.1's canonical schema
already carries everything the deviation engine needs.

## Where a standard plan does fit

Where the expiring terms happen to sit inside our guardrails, the matching SKU
is offered alongside the bespoke quote, marked for internal users so the
difference is visible. External presentation is deferred.

Naming: **"Plum Standard"**, confirmed. §6's "Plum exclusive" is superseded — the
label reads against a bespoke alternative, which is what it sits next to here.

## Continuation

Confirmed: **every member in the uploaded roster is a continuation.** The upload
is the current programme's active member list, and it is the population being
quoted for. So `is_continuation` defaults to true for a roster upload, and only
members added afterwards, by hand, default to false.

This also scopes the renewal flow, which is worth writing down now rather than
rediscovering later: renewals will draw the member list from Plum's own member
database instead of a file upload, but the logic downstream is identical — the
drawn list is the currently-covered population, so it arrives as continuations
too. The difference is the source of the roster, not what happens to it. Keeping
the deviation engine keyed on `member_records` rather than on the upload means
that swap is a new ingestion path, not a second engine.

## Open question

**LLM provider for policy parsing (§18.2).** See ADR 0008 — Claude is proposed,
with costs. This does not block building the pipeline, which is written
provider-agnostic with manual entry as the fallback; it blocks extraction
actually running.
