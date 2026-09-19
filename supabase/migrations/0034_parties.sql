-- ════════════════════════════════════════════════════════════════════════════
-- 0034 — insurers, TPAs and brokers as records rather than as typing.
--
-- These three were free text, which is fine on a screen and useless the moment
-- anybody asks which insurers we place the most business with. "Bajaj",
-- "Bajaj Allianz", "Bajaj Allianz General Insurance Co. Ltd." and "BAGIC" are
-- one company and were four answers.
--
-- Same split as customers (0028): a legal name for anything an insurer reads,
-- a short name for every screen, and aliases for what people actually type.
-- ════════════════════════════════════════════════════════════════════════════

-- --------------------------------------------------------------------------
-- 1. Folding a name down to what it is actually naming.
--
-- Indian company names carry a lot that does not distinguish them: the form
-- (Private Limited, Ltd), the trade (Insurance Brokers, General Insurance),
-- and "India". Stripping those leaves the part a person means when they say
-- who the broker was.
--
-- Immutable so a generated column can be built on it, which is what keeps this
-- the single implementation — the app matches on the stored fold rather than
-- reimplementing the rules in TypeScript and drifting.
-- --------------------------------------------------------------------------
create or replace function app.fold_party_name(p_name text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          lower(coalesce(p_name, '')),
          -- Punctuation and the words that never distinguish one party from
          -- another. Order matters only in that this runs before whitespace
          -- is collapsed.
          '\m(private|pvt|limited|ltd|llp|company|co|corporation|corp|insurance|assurance|general|health|broking|brokers|broker|services|service|tpa|third party administrator|india|indian)\M|[^a-z0-9 ]',
          ' ',
          'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function app.fold_party_name(text) is
  'A name reduced to its distinguishing part: "Bajaj Allianz General Insurance Co. Ltd." and "BAJAJ ALLIANZ" both fold to "bajaj allianz". Immutable so generated columns and unique indexes can be built on it.';

-- --------------------------------------------------------------------------
-- 2. Insurers — general and standalone health.
--
-- A closed list: there are roughly thirty, they change once or twice a year,
-- and quoting a company that is not one of them is a mistake rather than a
-- gap in our data.
-- --------------------------------------------------------------------------
create table insurers (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null unique,
  short_name    text not null,
  -- 'general' covers the non-life insurers; 'health' the standalone health
  -- insurers (SAHI). Both quote group medical, so both belong here.
  category      text not null check (category in ('general', 'health')),
  -- Deliberately nullable and deliberately unseeded: a registration number is
  -- a fact about a regulated entity and inventing one would be worse than not
  -- holding it. Filled by the IRDAI import.
  irdai_registration text,
  aliases       text[] not null default '{}',
  active        boolean not null default true,
  fold_key      text generated always as (app.fold_party_name(legal_name)) stored
);

create unique index insurers_fold_key_idx on insurers (fold_key);
create index insurers_short_name_idx on insurers (lower(short_name));

create table tpas (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null unique,
  short_name    text not null,
  irdai_registration text,
  aliases       text[] not null default '{}',
  active        boolean not null default true,
  fold_key      text generated always as (app.fold_party_name(legal_name)) stored
);

create unique index tpas_fold_key_idx on tpas (fold_key);

-- --------------------------------------------------------------------------
-- 3. Brokers — an open list that closes itself.
--
-- There are several hundred registered brokers and we meet perhaps fifty. A
-- dropdown of five hundred is worse than free text, and making an admin approve
-- every new name would block an RFQ on somebody else's inbox.
--
-- So anyone can add one and it is usable immediately, as 'seen'. The fold key
-- means a second spelling of a broker already on file resolves to the existing
-- row rather than creating a twin. A broker that turns up on enough deals is
-- promoted to 'listed' by `app.promote_brokers`, which is how the list grows
-- from real use instead of from a one-time import that is stale in six months.
-- --------------------------------------------------------------------------
create table brokers (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null unique,
  short_name    text not null,
  aliases       text[] not null default '{}',
  status        text not null default 'seen' check (status in ('listed', 'seen', 'merged')),
  -- Where a duplicate was folded into another row, so a deal pointing at the
  -- loser still resolves. Never deleted: the deals that referenced it are real.
  merged_into   uuid references brokers (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  fold_key      text generated always as (app.fold_party_name(legal_name)) stored,

  constraint brokers_merged_rows_name_a_target check (
    status <> 'merged' or merged_into is not null
  )
);

create unique index brokers_fold_key_idx on brokers (fold_key);
create index brokers_status_idx on brokers (status);

-- --------------------------------------------------------------------------
-- 4. Resolving a typed name to a party.
--
-- Tried in order: an exact fold match, then an alias. Nothing fuzzier — a
-- near-miss that silently picks the wrong insurer is worse than one that
-- creates a row somebody later merges.
-- --------------------------------------------------------------------------
create or replace function app.resolve_broker(p_name text)
returns uuid
language plpgsql
as $$
declare
  v_fold text := app.fold_party_name(p_name);
  v_id   uuid;
  v_short text;
begin
  if v_fold is null then
    return null;
  end if;

  select coalesce(b.merged_into, b.id) into v_id
    from brokers b
   where b.fold_key = v_fold
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select coalesce(b.merged_into, b.id) into v_id
    from brokers b
   where exists (
     select 1 from unnest(b.aliases) a where app.fold_party_name(a) = v_fold
   )
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  -- Not known, so it is known now. No approval step: a broker nobody has
  -- recorded before is an ordinary fact about a deal, not an exception.
  v_short := trim(p_name);
  insert into brokers (legal_name, short_name)
  values (trim(p_name), v_short)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.resolve_broker(text) is
  'The broker id for a typed name, creating one where the name is new. Never blocks: a name nobody has recorded is an ordinary fact about a deal.';

-- --------------------------------------------------------------------------
-- 5. Promoting the brokers we actually meet.
--
-- Run periodically. A broker on at least `p_threshold` deals is one we compete
-- with rather than one somebody typed once, and it joins the offered list.
-- --------------------------------------------------------------------------
create or replace function app.promote_brokers(p_threshold integer default 3)
returns integer
language sql
as $$
  with seen as (
    select b.id
      from brokers b
      join policies p on app.fold_party_name(p.broker_name) = b.fold_key
     where b.status = 'seen'
     group by b.id
    having count(distinct p.case_id) >= p_threshold
  ),
  promoted as (
    update brokers set status = 'listed'
     where id in (select id from seen)
     returning 1
  )
  select count(*)::integer from promoted;
$$;

comment on function app.promote_brokers(integer) is
  'Moves brokers seen on enough deals into the offered list. The list grows from real use rather than from an import that is stale in six months.';

-- --------------------------------------------------------------------------
-- 6. Reference data is readable by every active user, writable by nobody
--    through the API — these are curated lists, not case data (§15).
--
--    Brokers are the exception: `resolve_broker` writes one, and it runs as
--    the definer so an RM naming a new broker does not need write access to
--    the table itself.
-- --------------------------------------------------------------------------
alter function app.resolve_broker(text) security definer set search_path = public, app;

alter table insurers enable row level security;
alter table tpas enable row level security;
alter table brokers enable row level security;

create policy insurers_select on insurers for select to authenticated using (app.is_active_user());
create policy tpas_select on tpas for select to authenticated using (app.is_active_user());
create policy brokers_select on brokers for select to authenticated using (app.is_active_user());

grant select on insurers, tpas, brokers to authenticated;
grant execute on function app.resolve_broker(text) to authenticated;

create or replace function public.resolve_broker(p_name text)
returns uuid
language sql
as $$ select app.resolve_broker(p_name) $$;

grant execute on function public.resolve_broker(text) to authenticated;
