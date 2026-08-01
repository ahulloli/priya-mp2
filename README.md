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
  conversation-store.ts           shared conversation state (localStorage)
```

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

A high-risk turn sets a conversation-level state that survives later turns and
refreshes, so the turns after a disclosure continue it rather than resetting to
ordinary chat.

### Memory

PRIYA proposes at most one durable detail per turn — an upcoming event, a
long-term goal, an ongoing challenge — running alongside the reply so it costs
no latency. Passing emotions, credentials, and sensitive categories are never
proposed. A proposal is only a proposal: nothing is stored without an explicit
press, and the user sees the exact text first and can edit or delete it.

## Not built yet

Supabase persistence — conversations, memories, feedback, and reports all
currently live in `localStorage`, which is fine for solo testing but not for an
invite-only beta. Also unbuilt: the optional voice features (voice notes,
guided reflection, interview practice, check-ins).

The WebRTC audio loop has not been exercised in a browser.
