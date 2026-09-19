-- ════════════════════════════════════════════════════════════════════════════
-- 0040 — a deviation belongs to the option that causes it.
--
-- 0015 anticipated checking the roster twice: against the expiring policy when
-- it is uploaded, and against the RFQ once its terms are set. What it did not
-- anticipate is that an RFQ carries several options, and they deviate
-- differently — that is the entire point of having options. Option 2 lowering
-- the parent age ceiling to 70 puts a different set of lives outside the terms
-- than Option 3 dropping parents altogether.
--
-- Its unique key was (member_record_id, benefit_key, source), which allows
-- exactly one RFQ-side deviation per member per term. The second option to be
-- checked would have overwritten the first, and the screen would have shown one
-- option's exclusions against another option's terms.
-- ════════════════════════════════════════════════════════════════════════════

alter table member_deviations
  add column option_id uuid references rfq_options (id) on delete cascade;

comment on column member_deviations.option_id is
  'Which option''s terms put this life outside them. Null for the expiring policy, which has no options.';

-- --------------------------------------------------------------------------
-- The two sources have different shapes, so they get different rules rather
-- than one loose one.
--
-- Null is not a value in a unique constraint — two rows with a null option_id
-- do not conflict — so a single widened key would silently stop preventing
-- duplicate expiring-policy rows. Partial indexes say what is actually meant.
-- --------------------------------------------------------------------------
alter table member_deviations drop constraint member_deviations_member_record_id_benefit_key_source_key;

create unique index member_deviations_expiring_idx
  on member_deviations (member_record_id, benefit_key)
  where source = 'expiring_policy';

create unique index member_deviations_option_idx
  on member_deviations (member_record_id, benefit_key, option_id)
  where source = 'rfq';

alter table member_deviations
  add constraint member_deviations_option_matches_source check (
    (source = 'rfq' and option_id is not null)
    or (source <> 'rfq' and option_id is null)
  );

create index member_deviations_option_lookup_idx on member_deviations (option_id);
