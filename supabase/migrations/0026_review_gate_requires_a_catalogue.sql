-- ════════════════════════════════════════════════════════════════════════════
-- 0026 — the review gate must also require a catalogue to measure against.
--
-- The same fault as 0020, one level further out.
--
-- 0020 fixed "no terms means nothing is outstanding" by asking for coverage:
-- every benefit_key in benefit_catalogue must have a decided term. That is
-- right, and it is still vacuous when the CATALOGUE is empty — a left join
-- from zero rows produces zero rows, `not exists` is true, and a policy with
-- no terms at all against a catalogue with no benefits at all reports itself
-- ready for RFQ.
--
-- This is not hypothetical. It is the state of every database between
-- `db:migrate` and `db:import-guardrails`, which is the order CI runs them in,
-- and it would be the state of a freshly restored environment where the
-- workbook import had failed or been skipped. In both, the gate that exists to
-- stop unread terms reaching an insurer would have been wide open.
--
-- Completeness is a claim about a catalogue. With no catalogue there is
-- nothing to be complete against, so the honest answer is "not complete"
-- rather than "yes". A gate fails closed.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function app.policy_review_complete(p_policy_id uuid)
returns boolean
language sql
stable
as $$
  select
    -- There must be something to measure against...
    exists (select 1 from benefit_catalogue)
    -- ...and nothing left undecided against it.
    and not exists (
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
  'True only when the benefit catalogue is loaded AND every benefit_key in it has a decided term for this policy. A blank policy is not complete (0020); neither is any policy when the catalogue itself is empty (0026).';

-- policy_review_progress already reports totals from the catalogue, so an empty
-- catalogue shows 0 of 0 there — visibly nothing to do rather than silently
-- finished. No change needed; said here so the next reader does not go looking.
