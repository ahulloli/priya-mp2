-- Schema shape: tables, columns, keys, constraints.
--
-- Runs inside a transaction that is rolled back, so nothing here persists.

begin;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ------------------------------------------------------------ tables exist

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'conversations', 'conversations exists');
select has_table('public', 'messages', 'messages exists');
select has_table('public', 'memories', 'memories exists');
select has_table('public', 'feedback', 'feedback exists');
select has_table('public', 'reports', 'reports exists');
select has_table('public', 'safety_events', 'safety_events exists');
select has_table('public', 'voice_preferences', 'voice_preferences exists');

-- ------------------------------------------------ ownership and timestamps

select has_column('public', 'conversations', 'user_id', 'conversations.user_id');
select has_column('public', 'messages', 'user_id', 'messages.user_id');
select has_column('public', 'memories', 'user_id', 'memories.user_id');
select has_column('public', 'feedback', 'user_id', 'feedback.user_id');
select has_column('public', 'reports', 'user_id', 'reports.user_id');
select has_column('public', 'safety_events', 'user_id', 'safety_events.user_id');

select col_not_null('public', 'conversations', 'created_at',
  'conversations.created_at is not null');
select col_not_null('public', 'messages', 'created_at',
  'messages.created_at is not null');

-- ------------------------------------------------------------ foreign keys

select col_is_fk('public', 'messages', array['conversation_id'],
  'messages.conversation_id is a foreign key');
select col_is_fk('public', 'feedback', array['conversation_id'],
  'feedback.conversation_id is a foreign key');
select col_is_fk('public', 'reports', array['conversation_id'],
  'reports.conversation_id is a foreign key');
select col_is_fk('public', 'safety_events', array['conversation_id'],
  'safety_events.conversation_id is a foreign key');

-- -------------------------------------------------------- RLS is turned on

select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.conversations'::regclass$$,
  $$values (true)$$,
  'RLS enabled on conversations'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.messages'::regclass$$,
  $$values (true)$$,
  'RLS enabled on messages'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.memories'::regclass$$,
  $$values (true)$$,
  'RLS enabled on memories'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.feedback'::regclass$$,
  $$values (true)$$,
  'RLS enabled on feedback'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.reports'::regclass$$,
  $$values (true)$$,
  'RLS enabled on reports'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.safety_events'::regclass$$,
  $$values (true)$$,
  'RLS enabled on safety_events'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.voice_preferences'::regclass$$,
  $$values (true)$$,
  'RLS enabled on voice_preferences'
);
select results_eq(
  $$select relrowsecurity from pg_class
    where oid = 'public.profiles'::regclass$$,
  $$values (true)$$,
  'RLS enabled on profiles'
);

-- ----------------------------------------------------- anon has no grants
--
-- An unauthenticated caller holding the publishable key must not reach these
-- tables under any policy.

select is_empty(
  $$select table_name from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
      and table_name in (
        'conversations','messages','memories','feedback',
        'reports','safety_events','voice_preferences','profiles')$$,
  'anon has no table grants in public'
);

-- ------------------------------------------------------------- constraints

-- A conversation must have a valid mode.
select throws_ok(
  $$insert into public.conversations (id, user_id, mode)
    values ('conv_bad_mode', gen_random_uuid(), 'gossip')$$,
  '23514',
  null,
  'invalid conversation mode is rejected'
);

-- Safety phase is constrained to the state machine's values.
select throws_ok(
  $$insert into public.conversations (id, user_id, mode, safety_phase)
    values ('conv_bad_phase', gen_random_uuid(), 'listen', 'panicking')$$,
  '23514',
  null,
  'invalid safety phase is rejected'
);

-- Feedback scores stay on the 1-5 scale.
select throws_ok(
  $$insert into public.feedback (id, conversation_id, user_id, felt_understood)
    values ('fb_bad', 'conv_x', gen_random_uuid(), 9)$$,
  null,
  null,
  'out-of-range feedback score is rejected'
);

select * from finish();
rollback;
