-- 0014_span_write_for_all_hierarchy_roles.sql
-- Everyone in the reporting hierarchy transacts across their own span.
--
-- Confirmed intent: a user views and edits their own deals AND everything
-- beneath them in the reporting line. The reporting line is what stops a peer
-- reading or acting on your deals, while your manager, leader and head of
-- department can — they are your cover when you are unavailable.
--
-- This supersedes §15's "Can transact: No" for Leader and Head of Department.
-- The spec's table is treated as describing the intent behind the roles rather
-- than the final word, and the intent stated here is explicit.
--
-- Read and write now use the SAME span for every hierarchy role, which is the
-- simplification worth having: there is one rule — "your subtree" — instead of
-- a visibility rule and a separate, narrower transaction rule that could drift
-- apart.
--
-- Unchanged:
--   Admin       reads every deal, writes none. Not span-based, and §15's
--               read-only stance for the role is not what this revises.
--   Super Admin everything.
--
-- For a Consultant this is identical in practice, since a Consultant has no
-- reports and their span is themselves. It differs only if someone is ever
-- given a Consultant as their manager, in which case that Consultant gains the
-- same cover rights over them — consistent with the rule above.

create or replace function app.can_read_case(owner uuid)
returns boolean
language sql
stable
as $$
  select case app.current_role()
    when 'consultant'         then owner in (select app.span_user_ids())
    when 'manager'            then owner in (select app.span_user_ids())
    when 'leader'             then owner in (select app.span_user_ids())
    when 'head_of_department' then owner in (select app.span_user_ids())
    when 'admin'              then true
    when 'super_admin'        then true
    else false
  end;
$$;

create or replace function app.can_write_case(owner uuid)
returns boolean
language sql
stable
as $$
  select case app.current_role()
    when 'consultant'         then owner in (select app.span_user_ids())
    when 'manager'            then owner in (select app.span_user_ids())
    when 'leader'             then owner in (select app.span_user_ids())
    when 'head_of_department' then owner in (select app.span_user_ids())
    -- Admin is an administrative view over every deal, not a position in the
    -- hierarchy, so it reads everything and writes nothing (§15).
    when 'super_admin'        then true
    else false
  end;
$$;

comment on function app.can_read_case(uuid) is
  'Who may see a case: your own subtree for every hierarchy role; everything for Admin and Super Admin.';
comment on function app.can_write_case(uuid) is
  'Who may transact on a case: your own subtree for every hierarchy role. Admin is read-only; Super Admin may do anything.';
