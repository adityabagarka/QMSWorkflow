-- ════════════════════════════════════════════════════════════════════════════
-- 0031 — the RFQ gate learns about terms, and an RFQ knows which option it is.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Terms join the blocker list.
--
-- 0030 left this open with a note saying it would be added when the RFQ step
-- was built. It is being built, so here it is.
--
-- Term review is per-policy, and a rollover has exactly one expiring policy, so
-- the case can be asked the question directly. A case with no policy row at all
-- has nothing reviewed and is blocked — which is the honest answer, not an
-- oversight: you cannot ask an insurer to quote against terms that do not
-- exist.
-- --------------------------------------------------------------------------
create or replace function app.rfq_blockers(p_case_id uuid)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(blocker order by ord), array[]::text[])
  from (
    select 'documents' as blocker, 1 as ord
    where not app.case_documents_complete(p_case_id)

    union all
    select 'member_data', 2
    where not exists (select 1 from member_records where case_id = p_case_id)

    union all
    select 'claims_reconciliation', 3
    where not app.claims_reconciled(p_case_id)

    union all
    select 'policy_terms', 4
    where not exists (
      select 1 from policies p
      where p.case_id = p_case_id and app.policy_review_complete(p.id)
    )

    union all
    select 'rfq_options', 5
    where not exists (select 1 from rfq_options where case_id = p_case_id)
  ) blockers;
$$;

comment on function app.rfq_blockers(uuid) is
  'Why an RFQ cannot be dispatched yet, in the order the steps are worked. Empty means nothing is outstanding.';

-- --------------------------------------------------------------------------
-- 2. An RFQ records which option it went out on.
--
-- The comparison holds several options and the insurers are asked to quote
-- against a chosen one. Without recording which, a quote that comes back
-- cannot be read against the terms it answers — and six weeks later nobody
-- remembers whether option 2 or option 3 was the one sent.
-- --------------------------------------------------------------------------
alter table rfqs add column if not exists option_id uuid references rfq_options (id) on delete restrict;

comment on column rfqs.option_id is
  'The option this RFQ asks insurers to quote. Needed to read a returning quote against the terms it answers.';

-- One live RFQ per case: a second dispatch supersedes rather than runs
-- alongside, and two open RFQs on one deal is a state nobody could interpret.
create unique index if not exists rfqs_one_per_case on rfqs (case_id);

-- --------------------------------------------------------------------------
-- 3. Assembly is a snapshot, not a view.
--
-- What went to the insurer has to stay readable exactly as it was sent, even
-- after a term is corrected or the roster is reloaded. §16 wants the record;
-- §9 and §11 want a decline or a deemed acceptance to be explainable against
-- what was actually asked.
-- --------------------------------------------------------------------------
alter table rfqs add column if not exists assembled jsonb;

comment on column rfqs.assembled is
  'The RFQ exactly as dispatched: terms, demography, claims history. Frozen on purpose — correcting a term later must not rewrite what an insurer was asked.';

-- --------------------------------------------------------------------------
-- 4. Expose the gate where supabase.rpc() can find it.
--
-- PostgREST only sees the schemas Supabase exposes and `app` is not one, so an
-- app-schema function is invisible over HTTP however correct it is. This has
-- bitten before (see 0012, and the "account is not permitted" incident it came
-- out of), which is why the wrapper ships with the function rather than after
-- somebody notices.
-- --------------------------------------------------------------------------
create or replace function public.rfq_blockers(p_case_id uuid)
returns text[]
language sql
stable
as $$
  select app.rfq_blockers(p_case_id);
$$;

revoke all on function public.rfq_blockers(uuid) from public;
grant execute on function public.rfq_blockers(uuid) to authenticated, service_role;
