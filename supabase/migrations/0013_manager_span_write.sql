-- 0013_manager_span_write.sql
-- Managers transact across their team, not only on their own deals.
--
-- §15's table reads "Can transact (own deals)" for Manager, which M0
-- implemented conservatively as own-deals-only (ADR 0004 recorded it as
-- provisional and flagged it for confirmation). Confirmed otherwise: a Manager
-- edits their own deals AND their team's, at every depth of the reporting line
-- beneath them — so cover during leave, escalation and hand-over work without
-- reassigning ownership.
--
-- Leader and Head of Department remain read-only, as §15 states explicitly for
-- both. That is deliberately NOT changed here; see ADR 0004.

create or replace function app.can_write_case(owner uuid)
returns boolean
language sql
stable
as $$
  select case app.current_role()
    when 'consultant'  then owner = app.current_user_id()
    -- Own deals plus the full subtree: the same span used for visibility, so a
    -- Manager can act on anything they can see. Depth is unlimited — a
    -- Manager's reports' reports are still their team.
    when 'manager'     then owner in (select app.span_user_ids())
    when 'super_admin' then true
    else false
  end;
$$;

comment on function app.can_write_case(uuid) is
  'Who may transact on a case (§15). Consultant: own deals. Manager: own deals plus their entire reporting subtree. Leader, Head of Department and Admin: read-only. Super Admin: everything.';
