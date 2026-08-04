-- PRIYA schema.
--
-- Every user-owned table carries user_id and has Row Level Security enabled
-- with policies scoped to auth.uid(). RLS is the only thing standing between
-- one tester's conversations and another's, because the browser reaches this
-- database directly with a publishable key.
--
-- Ids are text rather than uuid: the application generates them (conv_<uuid>,
-- greeting_<conversationId>) and matching those exactly avoids a translation
-- layer that could silently drop or rewrite records.

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A profile should exist from the moment someone signs up, rather than being
-- created lazily by whichever code path happens to run first.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------- conversations

create table public.conversations (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mode text not null check (mode in ('listen', 'understand', 'similar', 'plan')),
  title text,
  summary text,
  safety_phase text not null default 'normal' check (
    safety_phase in (
      'normal',
      'supportive',
      'immediate_safety_check',
      'safety_follow_up',
      'resolved'
    )
  ),
  -- Which conversation the person is currently in. The partial unique index
  -- below keeps it to at most one per user.
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create index conversations_user_updated_idx
  on public.conversations (user_id, updated_at desc);

create unique index conversations_one_active_per_user_idx
  on public.conversations (user_id)
  where is_active;

-- ---------------------------------------------------------------- messages

create table public.messages (
  id text primary key,
  conversation_id text not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  input_type text check (input_type in ('text', 'voice')),
  output_type text check (output_type in ('text', 'voice')),
  interrupted boolean not null default false,
  safety_phase text not null default 'normal',
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------- memories

create table public.memories (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  summary text not null,
  category text not null default 'general',
  -- Nothing is written here without the user having approved it. The default
  -- is deliberately false, so an insert that forgets to say so produces an
  -- unused row rather than a memory nobody agreed to.
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memories_user_idx on public.memories (user_id, created_at);

-- ---------------------------------------------------------------- feedback

create table public.feedback (
  id text primary key,
  conversation_id text not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  felt_understood integer check (felt_understood between 1 and 5),
  helpful integer check (helpful between 1 and 5),
  has_next_step boolean,
  comments text,
  created_at timestamptz not null default now()
);

create index feedback_conversation_idx on public.feedback (conversation_id);

-- ----------------------------------------------------------------- reports

create table public.reports (
  id text primary key,
  conversation_id text not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null,
  -- Copied rather than joined, so a reported response survives the message
  -- being edited or deleted.
  content text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index reports_conversation_idx on public.reports (conversation_id);

-- ----------------------------------------------------------- safety_events

create table public.safety_events (
  id text primary key,
  conversation_id text not null
    references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text,
  state text not null check (state in ('normal', 'supportive', 'high_risk')),
  phase text not null,
  channel text not null check (channel in ('text', 'voice')),
  created_at timestamptz not null default now()
);

create index safety_events_user_created_idx
  on public.safety_events (user_id, created_at desc);

-- ------------------------------------------------------- voice_preferences

create table public.voice_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  voice text not null default 'marin',
  pace numeric not null default 1.0 check (pace between 0.7 and 1.2),
  warmth text not null default 'balanced',
  directness text not null default 'balanced',
  energy text not null default 'calm',
  response_length text not null default 'balanced',
  silence_ms integer not null default 700
    check (silence_ms between 200 and 3000),
  use_name boolean not null default false,
  name text,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------- row level security

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.feedback enable row level security;
alter table public.reports enable row level security;
alter table public.safety_events enable row level security;
alter table public.voice_preferences enable row level security;

-- Every policy targets the authenticated role explicitly and compares against
-- (select auth.uid()), which lets Postgres evaluate it once per statement
-- rather than once per row.

create policy "Users read their profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users update their profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users read their conversations"
  on public.conversations for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their conversations"
  on public.conversations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their conversations"
  on public.conversations for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their conversations"
  on public.conversations for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their messages"
  on public.messages for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their messages"
  on public.messages for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their messages"
  on public.messages for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their messages"
  on public.messages for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their memories"
  on public.memories for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their memories"
  on public.memories for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their memories"
  on public.memories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their memories"
  on public.memories for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their feedback"
  on public.feedback for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their feedback"
  on public.feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users read their reports"
  on public.reports for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their reports"
  on public.reports for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- Safety events are insert-and-read only on purpose. An audit trail its
-- subject can rewrite is not an audit trail.
create policy "Users read their safety events"
  on public.safety_events for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their safety events"
  on public.safety_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users read their voice preferences"
  on public.voice_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their voice preferences"
  on public.voice_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their voice preferences"
  on public.voice_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- --------------------------------------------------------------- privileges
--
-- Policies decide *which rows* a role may touch; grants decide whether the
-- role may touch the table at all. Without these, every request fails with
-- "permission denied" before any policy is consulted — RLS never even runs.
--
-- Nothing is granted to `anon`. An unauthenticated caller holding the
-- publishable key should not reach these tables under any policy.

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.memories to authenticated;
grant select, insert on public.feedback to authenticated;
grant select, insert on public.reports to authenticated;

-- Insert and read only: an audit trail its subject can rewrite is not one.
grant select, insert on public.safety_events to authenticated;

grant select, insert, update on public.voice_preferences to authenticated;

-- Supabase's default privileges hand `anon` TRUNCATE, TRIGGER and REFERENCES
-- on everything created in public. No SELECT or INSERT, so data was never
-- readable — but TRUNCATE bypasses RLS completely, and a privilege that can
-- empty a table has no business belonging to the unauthenticated role.
-- PostgREST does not expose TRUNCATE, so this is depth rather than a hole.

revoke all on public.profiles from anon;
revoke all on public.conversations from anon;
revoke all on public.messages from anon;
revoke all on public.memories from anon;
revoke all on public.feedback from anon;
revoke all on public.reports from anon;
revoke all on public.safety_events from anon;
revoke all on public.voice_preferences from anon;
