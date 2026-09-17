-- 0012_public_rpc_wrappers.sql
-- Expose the two onboarding operations to the application.
--
-- PostgREST — the layer supabase.rpc() talks to — only sees functions in the
-- schemas Supabase is configured to expose, which is `public` by default. The
-- helpers in 0007 and 0011 deliberately live in `app`, so supabase.rpc() could
-- not find them and every sign-in failed.
--
-- The fix is a thin wrapper in `public` per operation, rather than exposing the
-- whole `app` schema. Exposing `app` would publish every internal helper —
-- app.can_write_case, app.span_user_ids, app.consume_bootstrap_super_admin —
-- as a callable HTTP endpoint. Only these two are meant to be called from
-- outside, so only these two are published.
--
-- Parameters are plain text/uuid rather than the app-schema enum types: those
-- types are not in an exposed schema either, so PostgREST cannot describe or
-- cast to them. The wrappers cast, which also means an invalid role arrives as
-- a clear cast error rather than a schema-cache miss.
--
-- The wrappers are SECURITY INVOKER. They do not need to be definers: the
-- functions they call already are, and every permission check lives inside
-- those. A definer wrapper would only widen what runs as owner.

create or replace function public.provision_signed_in_user(
  p_user_id uuid,
  p_email   text,
  p_name    text
)
returns table (status text, role text)
language sql
as $$
  select s.status::text, s.role::text
  from app.provision_signed_in_user(p_user_id, p_email::citext, p_name) as s;
$$;

comment on function public.provision_signed_in_user(uuid, text, text) is
  'Called from the OAuth callback on every sign-in. Idempotent. Raises insufficient_privilege (42501) for an email outside allowed_email_domains.';

create or replace function public.decide_access_request(
  p_request_id uuid,
  p_approve    boolean,
  p_role       text default null,
  p_manager_id uuid default null,
  p_note       text default null
)
returns void
language sql
as $$
  select app.decide_access_request(
    p_request_id,
    p_approve,
    nullif(p_role, '')::app.user_role,
    p_manager_id,
    p_note
  );
$$;

comment on function public.decide_access_request(uuid, boolean, text, uuid, text) is
  'Approve or reject an access request (§15). All authorisation is enforced inside app.decide_access_request.';

revoke all on function public.provision_signed_in_user(uuid, text, text) from public;
revoke all on function public.decide_access_request(uuid, boolean, text, uuid, text) from public;

grant execute on function public.provision_signed_in_user(uuid, text, text)
  to authenticated, service_role;
grant execute on function public.decide_access_request(uuid, boolean, text, uuid, text)
  to authenticated, service_role;
