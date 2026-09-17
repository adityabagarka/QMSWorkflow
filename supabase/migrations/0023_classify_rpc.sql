-- 0023_classify_rpc.sql
-- Expose the change classifier where supabase.rpc() can find it (see 0012:
-- PostgREST only sees the schemas Supabase exposes, and `app` is not one).

create or replace function public.classify_term_change(
  p_benefit_key text,
  p_from        text,
  p_to          text
)
returns text
language sql
stable
as $$
  select app.classify_term_change(p_benefit_key, p_from, p_to)::text;
$$;

revoke all on function public.classify_term_change(text, text, text) from public;
grant execute on function public.classify_term_change(text, text, text)
  to authenticated, service_role;
