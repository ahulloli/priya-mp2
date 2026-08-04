-- The test that matters: two users, and neither can reach the other's rows.
--
-- Runs as the `authenticated` role with a forged JWT claim, which is exactly
-- what PostgREST does for a signed-in browser. It never uses the service role,
-- because the service role bypasses RLS and would pass this file trivially.

begin;
create extension if not exists pgtap with schema extensions;
-- These run locally. `supabase test db --linked` does not work against a
-- hosted project: pgTAP lives in the `extensions` schema there and the role
-- the CLI connects as has no USAGE on it ("permission denied for schema
-- extensions"). The migration is identical on both, verified by `db diff`,
-- and the hosted database is checked through PostgREST instead — which is
-- the path a browser actually takes.
set local search_path to extensions, public, pg_catalog;

select plan(22);

-- Two accounts. The trigger on auth.users creates their profiles.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.local');

-- Seed A's data as the table owner, before any impersonation begins.
insert into public.conversations (id, user_id, mode, is_active, title)
values ('conv_a', '11111111-1111-1111-1111-111111111111', 'listen', true,
        'A private conversation');

insert into public.messages (id, conversation_id, user_id, role, content)
values ('msg_a', 'conv_a', '11111111-1111-1111-1111-111111111111', 'user',
        'something A said in confidence');

insert into public.memories (id, user_id, summary, approved)
values ('mem_a', '11111111-1111-1111-1111-111111111111', 'A has a cat', true);

insert into public.feedback (id, conversation_id, user_id, felt_understood, helpful)
values ('fb_a', 'conv_a', '11111111-1111-1111-1111-111111111111', 5, 5);

insert into public.safety_events
  (id, conversation_id, user_id, state, phase, channel)
values ('se_a', 'conv_a', '11111111-1111-1111-1111-111111111111',
        'high_risk', 'immediate_safety_check', 'text');

-- ------------------------------------------------------------- as anonymous

set local role anon;

select throws_ok(
  $$select * from public.conversations$$,
  '42501',
  null,
  'anon cannot read conversations'
);
select throws_ok(
  $$select * from public.messages$$,
  '42501',
  null,
  'anon cannot read messages'
);
select throws_ok(
  $$select * from public.memories$$,
  '42501',
  null,
  'anon cannot read memories'
);
select throws_ok(
  $$insert into public.conversations (id, user_id, mode)
    values ('conv_anon', '11111111-1111-1111-1111-111111111111', 'listen')$$,
  '42501',
  null,
  'anon cannot write conversations'
);

reset role;

-- ---------------------------------------------------------------- as user A

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$select count(*)::int from public.conversations$$,
  $$values (1)$$,
  'A sees their own conversation'
);
select results_eq(
  $$select count(*)::int from public.messages$$,
  $$values (1)$$,
  'A sees their own message'
);
select results_eq(
  $$select count(*)::int from public.memories$$,
  $$values (1)$$,
  'A sees their own memory'
);
select results_eq(
  $$select count(*)::int from public.feedback$$,
  $$values (1)$$,
  'A sees their own feedback'
);
select results_eq(
  $$select count(*)::int from public.safety_events$$,
  $$values (1)$$,
  'A sees their own safety events'
);
select lives_ok(
  $$update public.memories set summary = 'A has two cats' where id = 'mem_a'$$,
  'A can update their own memory'
);

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------- as user B

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is_empty(
  $$select id from public.conversations$$,
  'B sees none of A''s conversations'
);
select is_empty(
  $$select id from public.messages$$,
  'B sees none of A''s messages'
);
select is_empty(
  $$select id from public.memories$$,
  'B sees none of A''s memories'
);
select is_empty(
  $$select id from public.feedback$$,
  'B sees none of A''s feedback'
);
select is_empty(
  $$select id from public.reports$$,
  'B sees none of A''s reports'
);
select is_empty(
  $$select id from public.safety_events$$,
  'B sees none of A''s safety events'
);
-- B legitimately sees their own profile, created by the signup trigger.
-- What matters is that A's is invisible.
select is_empty(
  $$select id from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'$$,
  'B cannot see A''s profile'
);
select results_eq(
  $$select count(*)::int from public.profiles$$,
  $$values (1)$$,
  'B sees exactly one profile: their own'
);

-- Writing a row owned by A is refused by the with-check clause.
select throws_ok(
  $$insert into public.conversations (id, user_id, mode)
    values ('conv_forged', '11111111-1111-1111-1111-111111111111', 'listen')$$,
  '42501',
  null,
  'B cannot forge a row owned by A'
);

-- Update and delete do not error; they simply match nothing. Verifying the
-- row survives is what proves isolation, not the absence of an exception.
update public.memories set summary = 'hijacked' where id = 'mem_a';
delete from public.conversations where id = 'conv_a';

reset role;
reset request.jwt.claims;

select results_eq(
  $$select summary from public.memories where id = 'mem_a'$$,
  $$values ('A has two cats'::text)$$,
  'A''s memory survived B''s update attempt'
);
select results_eq(
  $$select count(*)::int from public.conversations where id = 'conv_a'$$,
  $$values (1)$$,
  'A''s conversation survived B''s delete attempt'
);

-- B can still work in their own space.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select lives_ok(
  $$insert into public.conversations (id, user_id, mode)
    values ('conv_b', '22222222-2222-2222-2222-222222222222', 'plan')$$,
  'B can create their own conversation'
);

reset role;
reset request.jwt.claims;

select * from finish();
rollback;
