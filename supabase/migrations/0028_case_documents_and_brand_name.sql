-- ════════════════════════════════════════════════════════════════════════════
-- 0028 — the documents a deal is built from, and the name people actually use.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Brand name.
--
-- A company has two names and they are not interchangeable. "Meridian" is what
-- everybody says; "Meridian Logistics Private Limited" is what the policy is
-- issued in and what the GSTN register holds.
--
-- Carrying only the legal name makes every screen read like paperwork and makes
-- search worse, because nobody types the suffix. Carrying only the brand name
-- puts the wrong name on a policy, which is a real problem rather than an
-- aesthetic one — an insurer issues against the legal entity.
--
-- So both, with a rule: the brand name is for talking about the customer, the
-- legal name is for documents. Nullable, because until the GSTN record is
-- fetched there may only be one name and it is whatever was typed.
-- --------------------------------------------------------------------------
alter table customers add column brand_name text;

comment on column customers.brand_name is
  'What people call this customer day to day. Used on screen and in search; the policy, the RFQ and anything an insurer sees use legal_name.';

-- Searching should find "Meridian" whether it was stored as the brand or the
-- legal name, so both are indexed the same way.
create index customers_brand_name_idx on customers (lower(brand_name));

-- A legal name that is a GSTIN is not a name. This happens when somebody pastes
-- an identifier into a name field and nothing stops them — it happened on the
-- first real deal created through this app.
alter table customers add constraint customers_legal_name_not_a_gstin
  check (legal_name !~ '^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]{3}$');

-- --------------------------------------------------------------------------
-- 2. Case documents.
--
-- `policy_documents` already exists and requires a policy_id. That is right for
-- the policy copy and wrong for everything else: a member roster and a claims
-- dump belong to the DEAL, not to the expiring policy, and at the point they
-- are uploaded there may be no policy row at all. Documents-first intake (ADR
-- 0011) makes that the normal case rather than the edge one.
--
-- So documents hang off the case, and each one knows what kind it is — because
-- the RFQ dispatch gate has to answer "which of the four are missing", which a
-- bag of untyped files cannot.
-- --------------------------------------------------------------------------
create table case_documents (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references cases (id) on delete cascade,

  kind         text not null,
  file_ref     text not null,
  file_name    text not null,
  byte_size    bigint,
  content_type text,

  -- Where extraction has got to. Kept on the document rather than inferred from
  -- whether values exist, so a file that was read and yielded nothing is
  -- distinguishable from one nobody has read yet.
  read_state   text not null default 'uploaded',
  read_error   text,
  read_at      timestamptz,

  uploaded_by  uuid not null references app_users (id) on delete restrict,
  uploaded_at  timestamptz not null default now(),

  constraint case_documents_kind_known check (kind in (
    'policy_copy',   -- the expiring policy. Prose, so this is the one the model reads
    'member_data',   -- the roster being quoted for
    'claims_dump',   -- claim-level history
    'claims_mis',    -- the insurer's own summary of that history
    'other'          -- kept as evidence, never the source of a figure
  )),

  constraint case_documents_read_state_known check (read_state in (
    'uploaded',      -- stored, not yet looked at
    'reading',       -- extraction in flight
    'read',          -- extraction finished and produced something
    'empty',         -- read successfully and there was nothing in it
    'failed'         -- could not be read; read_error says why
  )),

  constraint case_documents_failure_explained check (
    read_state <> 'failed' or length(trim(coalesce(read_error, ''))) > 0
  )
);

comment on table case_documents is
  'Files a deal is built from (ADR 0011). Typed, because the RFQ dispatch gate must name which are missing. Case-scoped rather than policy-scoped: a roster is not a fact about the expiring policy.';

create index case_documents_case_idx on case_documents (case_id, kind);

-- A deal should not carry two current policy copies. Re-uploading replaces,
-- which the application does by deleting the old row first — and the constraint
-- is what makes that a rule rather than a habit. 'other' is exempt: there can
-- be any number of supporting files.
create unique index case_documents_one_per_kind
  on case_documents (case_id, kind)
  where kind <> 'other';

-- --------------------------------------------------------------------------
-- 3. RLS — documents inherit the permissions of their case.
-- --------------------------------------------------------------------------
alter table case_documents enable row level security;

create policy case_documents_select on case_documents for select to authenticated
  using (app.can_read_case(app.case_owner(case_id)));

create policy case_documents_insert on case_documents for insert to authenticated
  with check (app.can_write_case(app.case_owner(case_id)));

create policy case_documents_update on case_documents for update to authenticated
  using (app.can_write_case(app.case_owner(case_id)))
  with check (app.can_write_case(app.case_owner(case_id)));

create policy case_documents_delete on case_documents for delete to authenticated
  using (app.can_write_case(app.case_owner(case_id)));

grant select, insert, update, delete on case_documents to authenticated;

-- --------------------------------------------------------------------------
-- 4. The dispatch gate.
--
-- All four documents are mandatory to SEND an RFQ, and mandatory nowhere else
-- (ADR 0011 rule 1). An insurer cannot quote a programme whose member data or
-- claims history nobody has seen — but demanding them at intake would block
-- every deal on whichever document the insurer is slowest to release.
--
-- Same shape as the term review gate: the requirement is checked where the
-- obligation actually bites, and it names what is missing rather than saying no.
-- --------------------------------------------------------------------------
create or replace function app.case_documents_missing(p_case_id uuid)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(required.kind order by required.ord), array[]::text[])
  from (values
    ('policy_copy', 1),
    ('member_data', 2),
    ('claims_dump', 3),
    ('claims_mis',  4)
  ) as required(kind, ord)
  where not exists (
    select 1 from case_documents d
    where d.case_id = p_case_id and d.kind = required.kind
  );
$$;

comment on function app.case_documents_missing(uuid) is
  'Which of the four required documents a case still lacks, in the order they are asked for. Empty means the RFQ may be dispatched as far as documents are concerned.';

create or replace function app.case_documents_complete(p_case_id uuid)
returns boolean
language sql
stable
as $$
  select cardinality(app.case_documents_missing(p_case_id)) = 0;
$$;

grant execute on function
  app.case_documents_missing(uuid),
  app.case_documents_complete(uuid)
to authenticated, service_role;
