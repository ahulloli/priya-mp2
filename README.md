# PRIYA

**P**ersonalized **R**elational **I**ntelligence, **Y**our **A**lly — a warm AI
companion that helps adults reflect, get some clarity, and pick a realistic next
step. Text and voice.

> PRIYA is not a therapist, not a crisis service, and not a substitute for the
> people in someone's life. It says so, out loud, when that matters.

## Status

Phase 1 (text companion) and Phase 2 (voice) are built, with Supabase for
persistence and email/password auth. The WebRTC audio loop needs a browser
click-test; everything server-side is verified.

## Running it

```bash
npm install
cp .env.example .env.local   # then add your OpenAI key
npm run dev
```

```bash
npm run test    # deterministic, offline
npm run lint
npm run build
```

`npm run test:model` is a separate suite that calls the real API against a
running dev server. It is slow, costs money, and is inherently
non-deterministic, so it is not a gate — run it after changing prompts.

## How it fits together

```
app/
  page.tsx                        text + voice UI, one shared conversation
  api/chat/route.ts               text turn: moderate -> generate
  api/moderate/route.ts           safety gate for voice transcripts
  api/realtime/session/route.ts   mints ephemeral WebRTC tokens
  login/page.tsx                  email and password sign in
components/
  VoiceCall.tsx                   WebRTC session, VAD states, interruption
  MemoryPanel.tsx                 approve / edit / delete what PRIYA remembers
  VoiceSettings.tsx               voice, pace, warmth, directness, energy…
  CrisisPanel.tsx                 on-screen crisis resources
lib/
  priya-prompt.ts                 personality, voice, and boundaries
  safety.ts                       one classifier shared by text and voice
  safety-phase.ts                 phase transitions, shared with the browser
  conversation-store.ts           shared conversation state
  storage/                        PriyaStorage, and its two adapters
  supabase/                       browser and cookie-based server clients
supabase/
  migrations/                     the schema, RLS policies, and grants
  tests/                          pgTAP: schema, RLS isolation, integrity
```

### Storage

Components and the store never touch storage directly. Everything goes through
the `PriyaStorage` interface in `lib/storage/`, implemented by both
`SupabaseStorageAdapter` and `LocalStorageAdapter`. Supabase is used when it is
configured; otherwise the app falls back to `localStorage`, which keeps it
runnable offline and is what the storage tests exercise.

Records written before the shapes were finalised (`conversation_id`,
snake_case message fields) are migrated on read, so existing test data
survives.

### The four modes

`listen` · `understand` · `similar` · `plan` — each changes how PRIYA responds.
Selecting **plan** counts as consent to receive advice; the other modes ask
first.

### Safety

Every user message is classified before PRIYA answers. `self-harm/intent` or
`self-harm/instructions` routes to a crisis response instead of an ordinary
one, and the resources render on screen as well as being spoken — someone
distressed will not retain a number they heard once.

Voice uses a direct browser-to-OpenAI connection, but the realtime session sets
`create_response: false`, so PRIYA does not answer when the user stops
speaking. The client moderates the finished transcript and only then sends
`response.create`. Nothing is ever spoken before classification, and a failed
safety check leaves the turn unanswered rather than failing open. Barge-in
still works via `interrupt_response: true`.

Safety is one phase stored on the conversation and shared by both channels:

```
normal ──high_risk──> immediate_safety_check ──> safety_follow_up ──> resolved
```

A disclosure is sticky. It holds across as many turns as it takes, survives
refreshes, and carries into a voice session opened mid-conversation. Only the
user ends it, by pressing "I'm safe now" — hiding the crisis panel is a display
choice and deliberately does not clear the phase.

### Verifying the database

```bash
npm run verify:supabase   # db reset && db lint --level error && test db
```

63 pgTAP tests under `supabase/tests`: schema shape, foreign keys, RLS being
enabled, constraint rejection, cascades, duplicate-id rejection, and the
two-account isolation case. The isolation test runs as the `authenticated`
role with a forged JWT claim — never the service role, which bypasses RLS and
would pass the file trivially.

`supabase test db --linked` does **not** work against a hosted project: pgTAP
lives in the `extensions` schema there and the role the CLI connects as has no
`USAGE` on it. The hosted database is checked through PostgREST instead, with
two real accounts, which is the path a browser actually takes.

**Grants differ between local and hosted, and that is not fully fixable.**
Supabase's platform grants `authenticated` full CRUD on every table created in
`public`. The `lock_down_privileges` migration revokes the excess so the local
database holds exactly what PRIYA needs; on hosted the revoke does not stick,
because the grants were made by a role the migration cannot revoke on behalf
of. RLS is what enforces the intent there: `safety_events` has only `select`
and `insert` policies, so a user attempting to delete or rewrite their own
audit row changes nothing. That is verified against the hosted project, not
assumed.

### Rate limiting

`/api/chat`, `/api/moderate`, `/api/realtime/session` and `/api/memory-proposal`
are all rate limited per IP and reject cross-origin calls. The realtime route
gets the tightest budget because it mints credentials against the OpenAI
account.

This limiter is in-process, so on serverless it is per-instance and the
effective limit is multiplied by however many are warm. It raises the cost of
casual abuse; it is not a substitute for authentication and a shared store,
both of which are required before a public deployment.

### Memory

PRIYA proposes at most one durable detail per turn — an upcoming event, a
long-term goal, an ongoing challenge — running alongside the reply so it costs
no latency. Passing emotions, credentials, and sensitive categories are never
proposed. A proposal is only a proposal: nothing is stored without an explicit
press, and the user sees the exact text first. Saved memories stay editable.
Spoken turns propose memories too, via `/api/memory-proposal`.

## Not built yet

The rate limiter is still per-IP and in-process; with auth in place it should
become per-user quotas behind a shared store.

Local data is not migrated into Supabase. Anything already in a browser stays
there — export it from the app first if you want it.

Also unbuilt: the optional voice features — voice notes, guided reflection,
interview practice, check-ins.

**The WebRTC audio loop has never run in a browser.** Session setup, token
minting, moderation and the phase machine are all verified server-side, but
history seeding, barge-in truncation and the spoken loop itself are unexercised
until someone clicks the button with a microphone attached.
