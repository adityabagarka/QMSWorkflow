-- 130_parties.sql
-- Insurers, TPAs and brokers: the folding, and what happens to a name nobody
-- has recorded before.
--
-- The fold is the load-bearing part. It decides whether "Reliance General" on a
-- three-year-old schedule resolves to the company that now carries the book,
-- and whether a broker typed slightly differently becomes a second record that
-- splits every count in half.

begin;
select plan(16);

create temporary table px (who text primary key, id uuid default gen_random_uuid());
insert into px (who) values ('rm'), ('cust');
create or replace function pxid(text) returns uuid language sql stable as
  $$ select id from px where who = $1 $$;

insert into app_users (id, email, name, role, status)
values (pxid('rm'), 'parties-rm@example.test', 'RM', 'consultant', 'active');

insert into customers (id, legal_name, gstin)
values (pxid('cust'), 'Parties Synthetic Pvt Ltd', '99AAECP1234N1Z5');

insert into cases (id, customer_id, owner_user_id)
values ('cccc4444-0000-0000-0000-000000000001', pxid('cust'), pxid('rm'));

-- --------------------------------------------------------------------------
-- Folding: what a name is actually naming.
-- --------------------------------------------------------------------------
select is(
  app.fold_party_name('Bajaj General Insurance Limited'),
  app.fold_party_name('BAJAJ GENERAL INSURANCE LTD.'),
  'case and punctuation do not make a different company'
);

select is(
  app.fold_party_name('Marsh India Insurance Brokers Private Limited'),
  app.fold_party_name('Marsh India'),
  'the legal form and the trade fall away'
);

select isnt(
  app.fold_party_name('Health India Insurance TPA Services Private Limited'),
  app.fold_party_name('Health Insurance TPA of India Limited'),
  'two registered TPAs whose names differ only in structure stay two companies'
);

-- The first fold stripped "health", "india" and "general", and both of the
-- above came out as nothing at all. Named here so it cannot come back quietly.
select isnt(
  app.fold_party_name('Health India Insurance TPA Services Private Limited'),
  null,
  'a name made mostly of common words still folds to something'
);

select isnt(
  app.fold_party_name('Bajaj General Insurance Limited'),
  app.fold_party_name('Bajaj Allianz General Insurance Company Limited'),
  'a rename is not the same string, which is why aliases exist'
);

select is(
  app.fold_party_name('   '),
  null,
  'a name that is only whitespace names nobody'
);

-- --------------------------------------------------------------------------
-- The register, as seeded.
-- --------------------------------------------------------------------------
select ok(
  (select count(*) from insurers where active and category = 'general') >= 25,
  'the general insurers are loaded'
);

select ok(
  (select count(*) from insurers where active and category = 'health') >= 7,
  'the standalone health insurers are loaded'
);

select ok(
  (select count(*) from tpas where active) >= 15,
  'the TPAs are loaded'
);

-- A renamed insurer has to be reachable by the name on an old policy, or every
-- schedule issued before the rename resolves to nothing.
select is(
  (select i.short_name from insurers i
    where exists (
      select 1 from unnest(i.aliases) a
       where app.fold_party_name(a) = app.fold_party_name('Reliance General')
    )),
  'IndusInd General',
  'a policy naming Reliance General resolves to the company that now carries the book'
);

select is(
  (select t.short_name from tpas t
    where exists (
      select 1 from unnest(t.aliases) a
       where app.fold_party_name(a) = app.fold_party_name('East West Assist')
    )),
  'Volo Health',
  'and the same for a renamed TPA'
);

-- --------------------------------------------------------------------------
-- Brokers: an open list that does not block anybody.
-- --------------------------------------------------------------------------
select is(
  (select short_name from brokers where id = app.resolve_broker('Marsh India Insurance Brokers Private Limited')),
  'Marsh',
  'a known broker resolves to the record we already hold'
);

select is(
  app.resolve_broker('MARSH'),
  app.resolve_broker('Marsh India'),
  'two spellings of one broker are one broker'
);

-- Resolved in its own statement first: a SELECT takes its snapshot before the
-- function inside it inserts, so reading the new row in the same statement
-- finds nothing.
create temporary table new_broker as
  select app.resolve_broker('Kilburn Insurance Brokers Private Limited') as id;

select is(
  (select b.status from brokers b join new_broker n on n.id = b.id),
  'seen',
  'a broker nobody has recorded is recorded now, and usable immediately'
);

select is(
  app.resolve_broker('Kilburn Insurance Brokers Private Limited'),
  app.resolve_broker('Kilburn'),
  'and naming them again does not create a second record'
);

select is(
  app.resolve_broker(''),
  null,
  'an empty name creates nobody'
);

select * from finish();
rollback;
