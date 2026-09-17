-- 0020_review_gate_requires_coverage.sql
-- The review gate must require every term to exist, not merely that no existing
-- term is unreviewed.
--
-- As written in 0017, app.policy_review_complete() asked "are there any rows
-- still marked proposed?". On a policy where nobody had entered anything, the
-- answer was no — because there were no rows — so a completely blank policy
-- reported itself ready for RFQ.
--
-- That is the worst shape a gate can take: it looks like it is working, passes
-- in testing where terms happen to have been entered, and opens on exactly the
-- case it exists to catch.
--
-- Completeness is coverage: every benefit_key in benefit_catalogue has a term
-- that a human has decided. A term the policy genuinely does not mention is
-- still a decision — "not covered" is an answer, and the insurer needs it.

create or replace function app.policy_review_outstanding(p_policy_id uuid)
returns table (section text, outstanding bigint)
language sql
stable
as $$
  -- Left join from the catalogue, so a benefit with no row at all counts as
  -- outstanding in the same way as one still marked proposed.
  select b.section, count(*) as outstanding
  from benefit_catalogue b
  left join policy_terms t
    on t.benefit_key = b.benefit_key
   and t.policy_id = p_policy_id
  where t.id is null
     or t.review_status = 'proposed'
  group by b.section
  order by min(b.display_order);
$$;

comment on function app.policy_review_outstanding(uuid) is
  'Sections carrying terms that are missing entirely or still unreviewed, ordered as the catalogue is. Empty means the policy is ready for RFQ.';

create or replace function app.policy_review_complete(p_policy_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from benefit_catalogue b
    left join policy_terms t
      on t.benefit_key = b.benefit_key
     and t.policy_id = p_policy_id
    where t.id is null
       or t.review_status = 'proposed'
  );
$$;

comment on function app.policy_review_complete(uuid) is
  'True only when every benefit_key has a decided term. A blank policy is NOT complete — see migration 0020.';

-- How much is left, for a screen that wants to show progress rather than a
-- bare yes or no.
create or replace function app.policy_review_progress(p_policy_id uuid)
returns table (decided bigint, total bigint)
language sql
stable
as $$
  select
    count(*) filter (
      where t.id is not null and t.review_status <> 'proposed'
    ) as decided,
    count(*) as total
  from benefit_catalogue b
  left join policy_terms t
    on t.benefit_key = b.benefit_key
   and t.policy_id = p_policy_id;
$$;

grant execute on function
  app.policy_review_outstanding(uuid),
  app.policy_review_complete(uuid),
  app.policy_review_progress(uuid)
to authenticated, service_role;
