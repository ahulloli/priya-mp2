-- Data integrity: cascades, duplicate ids, and the one-active-conversation
-- rule the store depends on.

begin;
create extension if not exists pgtap with schema extensions;
-- These run locally. `supabase test db --linked` does not work against a
-- hosted project: pgTAP lives in the `extensions` schema there and the role
-- the CLI connects as has no USAGE on it ("permission denied for schema
-- extensions"). The migration is identical on both, verified by `db diff`,
-- and the hosted database is checked through PostgREST instead — which is
-- the path a browser actually takes.
set local search_path to extensions, public, pg_catalog;

select plan(12);

insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'integrity@test.local');

insert into public.conversations (id, user_id, mode)
values ('conv_i', '33333333-3333-3333-3333-333333333333', 'listen');

insert into public.messages (id, conversation_id, user_id, role, content)
values
  ('msg_i1', 'conv_i', '33333333-3333-3333-3333-333333333333', 'user', 'one'),
  ('msg_i2', 'conv_i', '33333333-3333-3333-3333-333333333333', 'assistant', 'two');

insert into public.feedback (id, conversation_id, user_id, felt_understood)
values ('fb_i', 'conv_i', '33333333-3333-3333-3333-333333333333', 4);

-- The trigger should have made a profile without anyone asking.
select results_eq(
  $$select count(*)::int from public.profiles
    where id = '33333333-3333-3333-3333-333333333333'$$,
  $$values (1)$$,
  'signup trigger creates a profile'
);

-- Re-inserting a message id must not duplicate the row. This is what makes
-- the store's retry-on-failure safe.
select throws_ok(
  $$insert into public.messages (id, conversation_id, user_id, role, content)
    values ('msg_i1', 'conv_i', '33333333-3333-3333-3333-333333333333',
            'user', 'duplicate')$$,
  '23505',
  null,
  'duplicate message id is rejected'
);

select results_eq(
  $$select count(*)::int from public.messages where conversation_id = 'conv_i'$$,
  $$values (2)$$,
  'the duplicate did not land'
);

-- An upsert on the same id updates rather than duplicating.
insert into public.messages (id, conversation_id, user_id, role, content)
values ('msg_i1', 'conv_i', '33333333-3333-3333-3333-333333333333',
        'user', 'edited')
on conflict (id) do update set content = excluded.content;

select results_eq(
  $$select content from public.messages where id = 'msg_i1'$$,
  $$values ('edited'::text)$$,
  'upsert updates the existing message'
);

-- A message cannot point at a conversation that does not exist.
select throws_ok(
  $$insert into public.messages (id, conversation_id, user_id, role, content)
    values ('msg_orphan', 'conv_missing',
            '33333333-3333-3333-3333-333333333333', 'user', 'orphan')$$,
  '23503',
  null,
  'a message cannot reference a missing conversation'
);

-- Deleting a conversation takes its children with it, leaving no orphans.
delete from public.conversations where id = 'conv_i';

select is_empty(
  $$select id from public.messages where conversation_id = 'conv_i'$$,
  'messages cascade when their conversation is deleted'
);
select is_empty(
  $$select id from public.feedback where conversation_id = 'conv_i'$$,
  'feedback cascades when its conversation is deleted'
);
select is_empty(
  $$select m.id from public.messages m
    left join public.conversations c on c.id = m.conversation_id
    where c.id is null$$,
  'no orphaned messages anywhere'
);

-- Only one conversation per user may be active, which is what lets the store
-- ask "which conversation am I in" without ambiguity.
insert into public.conversations (id, user_id, mode, is_active)
values ('conv_active_1', '33333333-3333-3333-3333-333333333333', 'listen', true);

select throws_ok(
  $$insert into public.conversations (id, user_id, mode, is_active)
    values ('conv_active_2', '33333333-3333-3333-3333-333333333333',
            'listen', true)$$,
  '23505',
  null,
  'a user cannot have two active conversations'
);

-- Deleting an account must take everything with it. Anything left behind is
-- data belonging to someone who asked to be gone.
insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'departing@test.local');

insert into public.conversations (id, user_id, mode)
values ('conv_gone', '55555555-5555-5555-5555-555555555555', 'listen');
insert into public.messages (id, conversation_id, user_id, role, content)
values ('msg_gone', 'conv_gone', '55555555-5555-5555-5555-555555555555',
        'user', 'said in confidence');
insert into public.memories (id, user_id, summary, approved)
values ('mem_gone', '55555555-5555-5555-5555-555555555555', 'remembered', true);
insert into public.safety_events (id, conversation_id, user_id, state, phase, channel)
values ('se_gone', 'conv_gone', '55555555-5555-5555-5555-555555555555',
        'supportive', 'supportive', 'text');

delete from auth.users where id = '55555555-5555-5555-5555-555555555555';

select is_empty(
  $$select id from public.conversations
    where user_id = '55555555-5555-5555-5555-555555555555'$$,
  'deleting an account removes their conversations'
);
select is_empty(
  $$select id from public.messages where id = 'msg_gone'$$,
  'deleting an account removes their messages'
);
select is_empty(
  $$select id from public.memories where id = 'mem_gone'$$,
  'deleting an account removes their memories'
);

select * from finish();
rollback;
