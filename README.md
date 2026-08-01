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

Voice uses a direct browser-to-OpenAI connection, so its gate is **reactive**:
moderation runs on transcripts as they land and cuts PRIYA off, but she may
already have spoken a sentence. The realtime instructions carry their own
crisis handling to cover that window. The text path still gates before
generating.

### Memory

Nothing is stored without an explicit press. The user sees the exact text
first, and can edit or delete it. Only approved memories are ever sent to the
model.

## Not built yet

Supabase persistence (conversations currently live in `localStorage`), feedback
ratings, PRIYA proposing her own memories, and the optional voice features —
voice notes, guided reflection, interview practice, check-ins.
