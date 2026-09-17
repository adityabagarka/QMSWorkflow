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

## Leader and Head of Department remain read-only

Deliberately unchanged. §15 states "Can transact: **No**" explicitly for both
roles, and that is what is implemented.

This is worth naming because the instruction that prompted this revision was
that the rule "applies to the entire hierarchy rolling up to the leader", which
could be read as granting Leaders and HoDs the same span-write rights. It has
not been read that way here: widening write access to two more roles on an
ambiguous reading, against an explicit "No" in the spec, is the kind of change
that is invisible until someone edits a deal they should not have.

If Leaders and Heads of Department should in fact transact across their span,
it is the same one-line change — add those roles to the `span_user_ids()` branch
of `app.can_write_case()` — plus the corresponding assertions in
`010_rls_role_span.sql`. Ask before making it.

## Assertions

`010_rls_role_span.sql` covers both directions: a Manager editing a direct
report's deal and every report's deal; a Manager failing to touch, create or
receive a case outside their subtree; and Leader, HoD and Admin updates still
reaching zero rows.
