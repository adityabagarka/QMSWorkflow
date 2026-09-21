-- ════════════════════════════════════════════════════════════════════════════
-- 0045 — let the person who owns the work replace what was derived from it.
--
-- Two flows in the app say "replace": uploading a corrected roster, and
-- re-running the roster against the expiring terms. Both were written as a
-- DELETE followed by an INSERT, issued as the signed-in user — and 0008 grants
-- DELETE on `member_records` and `member_deviations` to Super Admin alone.
--
-- Under RLS a DELETE that matches nothing is not an error. It removes no rows
-- and reports success, so for a Consultant both flows did the INSERT half only:
--
--   * A corrected roster did not replace the old one. It was ADDED to it. Two
--     uploads of the same 15 people made a 30-life deal, and a 30-life deal is
--     what the burn, the demography and the RFQ would all have been built on.
--   * Re-running the deviation check hit `member_deviations_expiring_idx` and
--     failed with a duplicate key. The action returned the error, the page
--     discarded it, and the button appeared to do nothing at all.
--
-- The fix is not to widen the DELETE policy. §15's stance — that ad-hoc
-- deletion is a Super Admin act — is right, and a blanket grant would also
-- permit deleting rows for a case somebody else owns. What the app needs is
-- narrower than that: clear the derived rows OF ONE CASE, for somebody who may
-- already write that case. That is a named operation, so it is a function with
-- the permission check inside it rather than a policy.
--
-- Nothing here touches `audit_log` or `case_events`: the history of the upload
-- stays, which is the point of keeping it somewhere these functions cannot
-- reach. What is cleared is derived data that the next upload recomputes.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- The roster.
-- --------------------------------------------------------------------------
create or replace function app.clear_member_records(p_case_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  removed integer;
begin
  if not app.can_write_case(app.case_owner(p_case_id)) then
    raise exception 'not permitted to replace the roster on this deal'
      using errcode = '42501';
  end if;

  delete from member_records where case_id = p_case_id;
  get diagnostics removed = row_count;
  return removed;
end $$;

comment on function app.clear_member_records(uuid) is
  'Clears one case''s roster so a corrected file can replace it. SECURITY DEFINER because DELETE on member_records is Super Admin only (0008) — the check here is narrower than that grant, not wider: it admits only somebody who may already write this case.';

-- --------------------------------------------------------------------------
-- The deviations, per source.
--
-- The source matters: deviations found against the expiring policy and against
-- an RFQ option are separate passes, and re-running one must not clear the
-- other (0040).
-- --------------------------------------------------------------------------
create or replace function app.clear_member_deviations(
  p_case_id uuid,
  p_source  app.deviation_source,
  p_option_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  removed integer;
begin
  if not app.can_write_case(app.case_owner(p_case_id)) then
    raise exception 'not permitted to re-check the roster on this deal'
      using errcode = '42501';
  end if;

  delete from member_deviations
   where case_id = p_case_id
     and source = p_source
     and (p_option_id is null or option_id = p_option_id);

  get diagnostics removed = row_count;
  return removed;
end $$;

comment on function app.clear_member_deviations(uuid, app.deviation_source, uuid) is
  'Clears one case''s deviations for one source, so the check can be re-run. Without it a second run collides with member_deviations_expiring_idx and the check can never be repeated.';

-- --------------------------------------------------------------------------
-- PostgREST only exposes `public`, so each one needs a wrapper there.
-- --------------------------------------------------------------------------
create or replace function public.clear_member_records(p_case_id uuid)
returns integer
language sql
as $$ select app.clear_member_records(p_case_id) $$;

create or replace function public.clear_member_deviations(
  p_case_id uuid,
  p_source  text,
  p_option_id uuid default null
)
returns integer
language sql
as $$ select app.clear_member_deviations(p_case_id, p_source::app.deviation_source, p_option_id) $$;

grant execute on function app.clear_member_records(uuid) to authenticated, service_role;
grant execute on function app.clear_member_deviations(uuid, app.deviation_source, uuid)
  to authenticated, service_role;
grant execute on function public.clear_member_records(uuid) to authenticated, service_role;
grant execute on function public.clear_member_deviations(uuid, text, uuid)
  to authenticated, service_role;
