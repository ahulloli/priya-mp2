# PRIYA

**P**ersonalized **R**elational **I**ntelligence, **Y**our **A**lly — a warm AI
companion that helps adults reflect, get some clarity, and pick a realistic next
step. Text and voice.

> PRIYA is not a therapist, not a crisis service, and not a substitute for the
> people in someone's life. It says so, out loud, when that matters.

## Status

Phase 1 (text companion) and Phase 2 (voice) are built. The WebRTC audio loop
needs a browser click-test; everything server-side is verified.

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
  storage/                        the seam Supabase slots into
```

### Storage

Components and the store never touch `localStorage`. Everything goes through
the `PriyaStorage` interface in `lib/storage/`, implemented today by
`LocalStorageAdapter`. Connecting Supabase means writing one more adapter and
changing one line in `lib/storage/index.ts` — no UI changes.

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

**Authentication and Supabase.** Conversations, memories, feedback and reports
all live in `localStorage`. Fine for solo testing, not for an invite-only beta,
and the rate limiter needs real per-user quotas behind a session.

Also unbuilt: the optional voice features — voice notes, guided reflection,
interview practice, check-ins.

**The WebRTC audio loop has never run in a browser.** Session setup, token
minting, moderation and the phase machine are all verified server-side, but
history seeding, barge-in truncation and the spoken loop itself are unexercised
until someone clicks the button with a microphone attached.
