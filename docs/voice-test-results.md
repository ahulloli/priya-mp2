# Voice test results

**Status: not yet run.** This has to be done by a person with a microphone and
headphones — every other part of the system is verified automatically, but
nothing can confirm that speaking and hearing work except speaking and hearing.

Run at `http://localhost:3010` in Chrome. Open DevTools console alongside;
benign realtime events (cancel, truncate) are logged at `debug` level, so
anything appearing as an **error** is worth recording.

## How to fill this in

Copy the block below once per scenario. Ten conversations minimum, and the ten
scenarios listed cover the paths most likely to break.

```text
Scenario:
Expected behavior:
Actual behavior:
Transcript accuracy:
Response delay:
Interruption worked:
Duplicate messages:
Safety behavior:
Bug severity:        (blocker | major | minor | cosmetic)
```

## What to measure

- **Response delay** — from when you stop speaking to PRIYA's first word.
  There is a deliberate moderation round trip in there now, so expect it to be
  slower than a raw realtime session. If it feels like a pause rather than a
  hesitation, say so.
- **First word clipped** — whether her opening syllable is cut off.
- **Duplicate turns** — the same thing appearing twice in the transcript.
- **Interrupted marking** — a turn you spoke over should be tagged
  `interrupted` in the transcript.

## Scenarios

1. Normal voice conversation
2. Interrupt PRIYA while she is speaking
3. Text → voice continuity (say something typed, then switch and refer to it)
4. Voice → text continuity
5. Change Listen to Plan **during** a call
6. Add or edit a memory **during** a call
7. Mute and unmute
8. Disconnect and reconnect the internet
9. Controlled supportive-risk message
10. Controlled high-risk message, then resolution via **I'm safe now**

## Known risks going in

These are the parts that have never executed, so they are the likeliest
failures:

- **Silence instead of an answer.** With `create_response: false`, PRIYA only
  speaks after moderation returns. If the transcription-completed event is ever
  missed, the turn goes unanswered rather than answered early. Watch for a turn
  that simply gets no reply.
- **Truncation accuracy.** How much of her turn she believes you heard is
  estimated from elapsed playback time. If her next turn refers to something
  she said after you cut her off, that estimate is wrong.
- **Mid-call resync.** Scenarios 5, 6 and 10 exercise instruction resync on a
  live session. Changing mode to Plan should change her behaviour without
  ending the call; resolving a crisis should return her to ordinary
  conversation rather than staying in follow-up.

## Results

_Nothing recorded yet._
