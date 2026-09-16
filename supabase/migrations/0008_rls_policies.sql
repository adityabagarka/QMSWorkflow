-- 0008_rls_policies.sql
-- Row-level security implementing §15.
--
-- §15 is explicit that this must hold at the database layer, so that a bug in
-- an application-layer permission check cannot leak cross-user deal data.
-- Application code is therefore treated as untrusted here.

-- --------------------------------------------------------------------------
-- app_users
--
-- Read: own row always; span for Manager/Leader/HoD; everything for
--       Admin/Super Admin. Everyone needs their own row to render a session.
-- Write: Super Admin generally (user provisioning, §15). Admin may write only
--        to finish onboarding a PENDING user — that is the approval step §15
--        grants them, and it stops short of managing active users.
-- --------------------------------------------------------------------------
alter table app_users enable row level security;

create policy app_users_select on app_users for select to authenticated
  using (
    id = app.current_user_id()
    or app.can_read_all_cases()
    or (app.current_role() in ('manager', 'leader', 'head_of_department')
        and id in (select app.span_user_ids()))
  );

create policy app_users_insert_super_admin on app_users for insert to authenticated
  with check (app.is_super_admin());

create policy app_users_update_super_admin on app_users for update to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());

-- Admin onboarding: may act on a pending user only, and may not mint another
-- Super Admin (that is user provisioning, reserved to Super Admin by §15).
create policy app_users_update_admin_onboarding on app_users for update to authenticated
  using (app.current_role() = 'admin' and status = 'pending')
  with check (app.current_role() = 'admin' and role is distinct from 'super_admin');

-- No DELETE policy anywhere: users are suspended, never deleted, so that
-- audit_log.actor_id and case ownership stay resolvable.

-- --------------------------------------------------------------------------
-- access_requests
-- --------------------------------------------------------------------------
alter table access_requests enable row level security;

create policy access_requests_select on access_requests for select to authenticated
  using (requested_by = app.current_user_id() or app.can_approve_access_requests());

-- A user raises their own request. The app creates this on first sign-in.
create policy access_requests_insert_self on access_requests for insert to authenticated
  with check (requested_by = app.current_user_id() and status = 'pending');

create policy access_requests_update_approver on access_requests for update to authenticated
  using (app.can_approve_access_requests())
  with check (app.can_approve_access_requests());

-- --------------------------------------------------------------------------
-- audit_log
--
-- Read: Super Admin only — §14 places audit log access in the Super Admin
--       console. INSERT is open to every active user, because every user's
--       actions must be recorded. UPDATE/DELETE have no policy and no grant,
--       and are additionally blocked by trigger (0004).
-- --------------------------------------------------------------------------
alter table audit_log enable row level security;

create policy audit_log_select_super_admin on audit_log for select to authenticated
  using (app.is_super_admin());

create policy audit_log_insert on audit_log for insert to authenticated
  with check (app.is_active_user());

-- --------------------------------------------------------------------------
-- cases
-- --------------------------------------------------------------------------
alter table cases enable row level security;

create policy cases_select on cases for select to authenticated
  using (app.can_read_case(owner_user_id));

create policy cases_insert on cases for insert to authenticated
  with check (app.can_write_case(owner_user_id));

-- Both USING and WITH CHECK: a user who may edit a case must not be able to
-- reassign it to an owner they could not write to, which would otherwise let
-- them push a row outside their own visibility.
create policy cases_update on cases for update to authenticated
  using (app.can_write_case(owner_user_id))
  with check (app.can_write_case(owner_user_id));

create policy cases_delete_super_admin on cases for delete to authenticated
  using (app.is_super_admin());

-- --------------------------------------------------------------------------
-- Case descendants.
--
-- Identical shape on every table: read if you can read the case, write if you
-- can write the case. Generated rather than hand-written so that no table can
-- drift from the matrix, and so adding a table in M1-M7 is one array entry.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
  descendants text[] := array[
    'case_events','policies','policy_documents','policy_extractions',
    'policy_extraction_edits','policy_terms','plan_matches','member_uploads',
    'member_records','member_data_exclusions','claims_uploads',
    'burn_calculations','rfqs','compliance_reviews','insurer_rfqs',
    'quote_versions','reminders_log','clarifications','negotiation_rounds',
    'customer_quote_links','customer_link_views','customer_decisions','issuance'
  ];
begin
  foreach t in array descendants loop
    execute format('alter table %I enable row level security', t);

    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app.can_read_case(app.case_owner(case_id)))
    $f$, t);

    execute format($f$
      create policy %1$I_insert on %1$I for insert to authenticated
        with check (app.can_write_case(app.case_owner(case_id)))
    $f$, t);

    execute format($f$
      create policy %1$I_update on %1$I for update to authenticated
        using (app.can_write_case(app.case_owner(case_id)))
        with check (app.can_write_case(app.case_owner(case_id)))
    $f$, t);

    execute format($f$
      create policy %1$I_delete on %1$I for delete to authenticated
        using (app.is_super_admin())
    $f$, t);
  end loop;
end
$$;

-- Append-only child tables (§4.2, §8, §10): no UPDATE policy, so corrections
-- are new rows. Enforced again by grant in 0009.
drop policy policy_extraction_edits_update on policy_extraction_edits;
drop policy burn_calculations_update on burn_calculations;
drop policy case_events_update on case_events;

-- --------------------------------------------------------------------------
-- Guardrails reference data (§4.3).
--
-- Readable by every active user — the engine and the comparison screens need
-- it. Writable by Admin and Super Admin only: this is the Admin's "configure
-- pre-approved plans" permission, exercised as CRUD through the app rather
-- than as a code change.
-- --------------------------------------------------------------------------
do $$
declare
  t text;
  reference_tables text[] := array[
    'ref_enums','benefit_catalogue','sku_pricing','sku_coverage',
    'insurer_guardrails','insurer_family_guardrails','insurer_member_age_windows',
    'member_data_rules','appetite_industry','appetite_entity',
    'rate_base','rate_factors'
  ];
begin
  foreach t in array reference_tables loop
    execute format('alter table %I enable row level security', t);

    execute format($f$
      create policy %1$I_select on %1$I for select to authenticated
        using (app.is_active_user())
    $f$, t);

    execute format($f$
      create policy %1$I_write on %1$I for all to authenticated
        using (app.can_write_reference_data())
        with check (app.can_write_reference_data())
    $f$, t);
  end loop;
end
$$;

-- --------------------------------------------------------------------------
-- salesforce_accounts: system configuration, Super Admin only (§15).
-- --------------------------------------------------------------------------
alter table salesforce_accounts enable row level security;

create policy salesforce_accounts_all_super_admin on salesforce_accounts for all to authenticated
  using (app.is_super_admin()) with check (app.is_super_admin());
