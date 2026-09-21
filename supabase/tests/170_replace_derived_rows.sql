-- 170_replace_derived_rows.sql
-- Replacing a roster, and re-running the deviation check.
--
-- Both flows are a clear followed by an insert, and both were written as a
-- DELETE issued as the signed-in user — which 0008 grants to Super Admin alone.
-- Under RLS that DELETE is not an error: it removes nothing and reports
-- success. So a corrected roster was added to the old one instead of replacing
-- it, and the second run of the deviation check collided with its own unique
-- index. Neither failure was visible from the outside, which is what these
-- assertions are for.

begin;
select plan(10);

create temporary table fx (who text primary key, id uuid default gen_random_uuid());
insert into fx (who) values ('rm'), ('other'), ('cust');
create or replace function fxid(text) returns uuid language sql stable as
  $$ select id from fx where who = $1 $$;

grant select on fx to authenticated;
grant execute on function fxid(text) to authenticated;

create or replace procedure act_as(p_who text) language plpgsql as $$
begin
  perform set_config('app.current_user_id', (select id from fx where who = p_who)::text, true);
end $$;

insert into app_users (id, email, name, role, status) values
  (fxid('rm'),    'replace-rm@example.test',    'RM',    'consultant', 'active'),
  (fxid('other'), 'replace-other@example.test', 'Other', 'consultant', 'active');

insert into customers (id, legal_name, gstin)
values (fxid('cust'), 'Replace Synthetic Pvt Ltd', '99AAECF9876N1Z5');

insert into cases (id, customer_id, owner_user_id)
values ('dddd7777-0000-0000-0000-000000000001', fxid('cust'), fxid('rm'));

insert into policies (id, case_id, insurer_name)
values ('dddd7777-0000-0000-0000-0000000000f1', 'dddd7777-0000-0000-0000-000000000001', 'Synthetic General');

insert into member_records (id, case_id, relationship, age) values
  ('dddd7777-0000-0000-0000-00000000a001', 'dddd7777-0000-0000-0000-000000000001', 'self',   34),
  ('dddd7777-0000-0000-0000-00000000a002', 'dddd7777-0000-0000-0000-000000000001', 'parent', 82);

insert into benefit_catalogue (benefit_key, display_order, section, benefit_label)
values ('max_age_parents', 9001, 'Eligibility', 'Maximum age — parents')
on conflict (benefit_key) do nothing;

-- ==========================================================================
-- The roster: a corrected file replaces, it does not accumulate.
-- ==========================================================================
call act_as('rm');
set local role authenticated;

select is(clear_member_records('dddd7777-0000-0000-0000-000000000001'), 2,
  'A consultant clears their own deal''s roster');
select is((select count(*) from member_records
            where case_id = 'dddd7777-0000-0000-0000-000000000001')::int, 0,
  'and the roster is actually gone, not filtered away');

-- The upload that follows a clear.
insert into member_records (case_id, relationship, age)
values ('dddd7777-0000-0000-0000-000000000001', 'self', 41);

select is((select count(*) from member_records
            where case_id = 'dddd7777-0000-0000-0000-000000000001')::int, 1,
  'a re-upload leaves one roster, not two');

reset role;

-- ==========================================================================
-- The deviation check: re-runnable, which is the whole point of the button.
-- ==========================================================================
insert into member_records (id, case_id, relationship, age)
values ('dddd7777-0000-0000-0000-00000000a003', 'dddd7777-0000-0000-0000-000000000001', 'parent', 82);

call act_as('rm');
set local role authenticated;

insert into member_deviations (case_id, member_record_id, benefit_key, source, detail, is_continuation)
values ('dddd7777-0000-0000-0000-000000000001', 'dddd7777-0000-0000-0000-00000000a003',
        'max_age_parents', 'expiring_policy', '82 is above the 80 ceiling', true);

select is(clear_member_deviations('dddd7777-0000-0000-0000-000000000001', 'expiring_policy'), 1,
  'A consultant clears their own deal''s deviations');

select lives_ok(
  $$insert into member_deviations (case_id, member_record_id, benefit_key, source, detail, is_continuation)
    values ('dddd7777-0000-0000-0000-000000000001', 'dddd7777-0000-0000-0000-00000000a003',
            'max_age_parents', 'expiring_policy', '82 is above the 80 ceiling', true)$$,
  'so the check can be run a second time without colliding with its own index');

-- The bare DELETE is still Super Admin only. These functions are narrower than
-- that grant, not a way around it.
delete from member_deviations where case_id = 'dddd7777-0000-0000-0000-000000000001';
select is((select count(*) from member_deviations
            where case_id = 'dddd7777-0000-0000-0000-000000000001')::int, 1,
  'a plain DELETE still removes nothing for a consultant');

-- ==========================================================================
-- Somebody else's deal is refused outright, not silently ignored.
-- ==========================================================================
call act_as('other');

select throws_ok(
  $$select clear_member_records('dddd7777-0000-0000-0000-000000000001')$$,
  '42501',
  'not permitted to replace the roster on this deal',
  'Another consultant cannot clear a roster on a deal they cannot write');

select throws_ok(
  $$select clear_member_deviations('dddd7777-0000-0000-0000-000000000001', 'expiring_policy')$$,
  '42501',
  'not permitted to re-check the roster on this deal',
  'nor the deviations');

reset role;

select is((select count(*) from member_records
            where case_id = 'dddd7777-0000-0000-0000-000000000001')::int, 2,
  'and the refusal left the roster untouched');
select is((select count(*) from member_deviations
            where case_id = 'dddd7777-0000-0000-0000-000000000001')::int, 1,
  'and left the deviations untouched');

select * from finish();
rollback;
