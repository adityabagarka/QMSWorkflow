-- ════════════════════════════════════════════════════════════════════════════
-- 0041 — let a draft deal be thrown away.
--
-- Picking a customer now creates the deal immediately, so the document slots
-- have something to attach to. That is the right trade for the person doing the
-- work and the wrong one for the database: every abandoned search leaves a row
-- behind, and a deal list full of half-started deals is worse than an extra
-- click.
--
-- So the owner can delete one — but only while it is genuinely a draft. Once
-- anything real is attached, a deal is a record of work and deleting it would
-- take the audit trail with it (§16). Super Admin deletion (0008) is unchanged.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.case_is_draft(p_case_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (select 1 from member_records  where case_id = p_case_id)
     and not exists (select 1 from claims_uploads  where case_id = p_case_id)
     and not exists (select 1 from policy_terms    where case_id = p_case_id)
     and not exists (select 1 from rfqs            where case_id = p_case_id)
     and not exists (select 1 from rfq_options     where case_id = p_case_id)
     and not exists (select 1 from case_documents  where case_id = p_case_id);
$$;

comment on function app.case_is_draft(uuid) is
  'A deal nobody has put anything into: no roster, no claims, no terms, no documents, no RFQ. The only kind that can be deleted by its owner — anything else is a record of work, and deleting it would take the audit trail with it.';

create policy cases_delete_own_draft on cases for delete to authenticated
  using (app.can_write_case(owner_user_id) and app.case_is_draft(id));

grant execute on function app.case_is_draft(uuid) to authenticated, service_role;

create or replace function public.case_is_draft(p_case_id uuid)
returns boolean
language sql
stable
as $$ select app.case_is_draft(p_case_id) $$;

grant execute on function public.case_is_draft(uuid) to authenticated, service_role;
