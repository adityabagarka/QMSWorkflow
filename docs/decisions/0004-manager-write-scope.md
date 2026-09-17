# 0004 — Manager write scope

**Status:** accepted (revised 17 Sep 2026)
**Relates to:** ARCHITECTURE.md §15

## The ambiguity

§15's row for Manager reads:

| Role    | Deal visibility       | Can transact (own deals)                    |
| ------- | --------------------- | ------------------------------------------- |
| Manager | Own deals + team span | Yes (both capabilities, no per-user toggle) |

The column header says "own deals", but the cell says "both capabilities".

M0 shipped the conservative reading — Manager writes only their own deals — and
flagged it for confirmation, on the grounds that under-granting is recoverable
and over-granting is not.

## Decision

Confirmed otherwise. **A Manager transacts on their own deals and on their
team's**, at every depth of the reporting line beneath them — not merely views
the team. Implemented in `0013_manager_span_write.sql`: the `manager` branch of
`app.can_write_case()` now uses the same `app.span_user_ids()` walk as
visibility, so a Manager can act on anything they can see.

The practical reason: cover during leave, escalation and hand-over should not
require reassigning ownership of a deal, which would distort the record of whose
deal it actually is.

Two boundaries still hold, and are asserted:

- A Manager cannot reach a case outside their own subtree, for reading or
  writing. Editing rights follow the reporting line, not the organisation.
- A Manager may hand a deal to anyone inside their team, but cannot reassign one
  to somebody outside it — that would push a case out of their own sight.

## Leaders and Heads of Department too

Confirmed after the first revision, and implemented in
`0014_span_write_for_all_hierarchy_roles.sql`: **every role in the reporting
hierarchy views and edits its own span**, not just Managers.

The rationale given, which is worth recording because it explains the shape:

> roll up prevents a parallel user looking at my deals or transacting on them,
> but my manager/leader/HOD would have access to my deals — this becomes my
> backup.

So the reporting line is doing two jobs at once. Downward it is cover: anyone
above you can pick up your work when you are unavailable. Sideways it is
isolation: a peer cannot see or touch your deals at all.

This supersedes §15's "Can transact: **No**" for Leader and Head of Department.
The table is treated as describing the intent behind the roles rather than the
last word on it, since the intent has now been stated directly.

Read and write use the same span for every hierarchy role, which is the
simplification worth having: one rule — "your subtree" — rather than a
visibility rule and a separate, narrower transaction rule that can drift apart
as the system grows.

### What did not change

**Admin still reads every deal and writes none.** Admin is an administrative
view across the whole organisation, not a position in the hierarchy, so the
span argument does not apply to it and §15's read-only stance stands. Admin's
write access remains what §4.3 grants it: the guardrails reference data.

**Consultant is unchanged in practice.** A Consultant's span is themselves, so
nothing differs today. It would differ only if someone were given a Consultant
as their manager, in which case that Consultant gains the same cover rights —
which is the rule applied consistently rather than an exception.

## Assertions

`010_rls_role_span.sql` covers both directions:

- a Manager editing a direct report's deal, and every report's deal
- a Head of Department editing a grandchild's deal, across both branches of the
  subtree
- a Leader with no reports creating their own case but still unable to reach
  anything outside their subtree
- a Manager failing to touch, create or receive a case outside their subtree,
  including that reassigning a deal out of their own visibility is a hard error
  rather than a silent no-op
- Admin updates still reaching zero deal rows
