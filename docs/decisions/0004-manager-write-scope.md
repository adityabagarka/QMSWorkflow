# 0004 — Manager write scope

**Status:** provisional (M0) — needs confirmation
**Relates to:** ARCHITECTURE.md §15

## The ambiguity

§15's row for Manager reads:

| Role    | Deal visibility       | Can transact (own deals)                    |
| ------- | --------------------- | ------------------------------------------- |
| Manager | Own deals + team span | Yes (both capabilities, no per-user toggle) |

The column header says "own deals", but the cell says "both capabilities",
which could mean a Manager transacts across their whole span.

## Decision, for now

Implemented conservatively: a Manager **reads** their full subtree and **writes
only their own deals**. `app.can_write_case()` treats `manager` exactly as
`consultant`.

The reading behind it: "both capabilities" most likely describes a Manager being
simultaneously an individual contributor (who transacts) and a manager (who sees
the team), rather than granting write access across the team. Under-granting is
also the safer error — widening it later is a one-line change to
`app.can_write_case()` with no data migration, whereas discovering that managers
have been editing their reports' deals is not recoverable.

## What to confirm

Should a Manager be able to transact on a direct or indirect report's deal —
for example, progressing a case while that consultant is on leave?

If yes, change the `'manager'` branch of `app.can_write_case()` from
`owner = app.current_user_id()` to `owner in (select app.span_user_ids())`, and
update the corresponding assertion in `supabase/tests/010_rls_role_span.sql`.
