-- 0017_policy_term_review.sql
-- Per-term review state, so an unreviewed term cannot reach an RFQ.
-- Reference: ARCHITECTURE.md §8, §14; ADR 0009.

create type app.term_review_status as enum (
  'proposed',   -- extracted or entered, not yet looked at by a human
  'confirmed',  -- a human read it and the value was right
  'corrected'   -- a human read it and changed it
);

alter table policy_terms
  add column review_status app.term_review_status not null default 'proposed',
  add column reviewed_by uuid references app_users (id) on delete restrict,
  add column reviewed_at timestamptz,
  add column extraction_confidence numeric,

  -- A reviewed term must say who reviewed it and when. Without this the status
  -- is just a colour on a screen; with it, it is a record of a decision.
  add constraint policy_terms_review_is_attributable check (
    review_status = 'proposed'
    or (reviewed_by is not null and reviewed_at is not null)
  ),

  add constraint policy_terms_confidence_range check (
    extraction_confidence is null
    or extraction_confidence between 0 and 1
  );

comment on column policy_terms.review_status is
  'proposed until a human acts. confirmed and corrected are kept distinct on purpose: a model whose values are always corrected is not working, and one always confirmed may mean it is excellent or that nobody is looking. Collapsing them loses that.';
comment on column policy_terms.extraction_confidence is
  'What the model claimed, retained so confidence can be measured against review outcomes rather than trusted.';

create index policy_terms_review_idx on policy_terms (policy_id, review_status);

-- --------------------------------------------------------------------------
-- The dispatch gate (ADR 0009 §5).
--
-- Expressed in the database rather than only in the UI, for the same reason as
-- §15's access rules: the screen is the place a check is most easily forgotten,
-- and this one decides whether an insurer is quoted terms nobody read.
-- --------------------------------------------------------------------------
create or replace function app.policy_review_outstanding(p_policy_id uuid)
returns table (section text, outstanding bigint)
language sql
stable
as $$
  select b.section, count(*) as outstanding
  from policy_terms t
  join benefit_catalogue b on b.benefit_key = t.benefit_key
  where t.policy_id = p_policy_id
    and t.review_status = 'proposed'
  group by b.section
  order by b.section;
$$;

comment on function app.policy_review_outstanding(uuid) is
  'Sections of the policy still carrying unreviewed terms. Empty means the policy is ready to go to RFQ.';

create or replace function app.policy_review_complete(p_policy_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from policy_terms t
    where t.policy_id = p_policy_id
      and t.review_status = 'proposed'
  );
$$;

grant execute on function
  app.policy_review_outstanding(uuid),
  app.policy_review_complete(uuid)
to authenticated, service_role;
