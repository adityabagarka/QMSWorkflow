-- 040_storage_paths.sql
-- The case id is parsed out of a storage object path, and must fail closed.
--
-- This function decides which case a file belongs to, and therefore who may
-- read it. A census file is the most sensitive thing in the system, so a
-- malformed path must resolve to nothing rather than to some other case.
--
-- The storage schema itself only exists on Supabase, so the policies that use
-- this cannot be exercised locally. The parsing can, and it is where the sharp
-- edge is.

begin;
select plan(8);

select is(
  app.storage_case_id('cases/3f2504e0-4f89-11d3-9a0c-0305e82c3301/policy/copy.pdf'),
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301'::uuid,
  'a well-formed path yields its case id');

select is(
  app.storage_case_id('cases/3f2504e0-4f89-11d3-9a0c-0305e82c3301/members/roster.csv'),
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301'::uuid,
  'the document kind does not affect which case it belongs to');

select is(app.storage_case_id('cases/not-a-uuid/policy/copy.pdf'), null,
  'a non-uuid second segment yields null, not an error');

select is(app.storage_case_id('other/3f2504e0-4f89-11d3-9a0c-0305e82c3301/x.pdf'), null,
  'a path outside the cases prefix yields null');

select is(app.storage_case_id('cases/copy.pdf'), null,
  'a path too short to carry a case id yields null');

select is(app.storage_case_id('copy.pdf'), null,
  'a bare filename yields null');

select is(app.storage_case_id(''), null,
  'an empty path yields null');

-- A path that climbs out of its own folder must not land in another case.
select is(
  app.storage_case_id('cases/../cases/3f2504e0-4f89-11d3-9a0c-0305e82c3301/policy/copy.pdf'),
  null,
  'a traversal attempt does not resolve to a case id');

select * from finish();
rollback;
