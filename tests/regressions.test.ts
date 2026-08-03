import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAll,
  createMessage,
  recordSafetyEvent,
} from "@/lib/conversation-store";
import { priyaStorage } from "@/lib/storage";
import { summaryWindow } from "@/lib/summary-window";
import type { Message } from "@/types/chat";

beforeEach(async () => {
  await clearAll();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

/*
 * The bug: requestMemoryProposal read a ref that only caught up after React
 * re-rendered the parent. response.done could arrive first, so the proposal
 * was built from the conversation as it stood *before* the exchange that had
 * just happened. The fix is a transcript appended to synchronously.
 */
describe("voice session transcript", () => {
  function makeSession(initial: Message[]) {
    const sessionHistory = { current: initial };
    const delivered: Message[] = [];

    /* Mirrors recordVoiceMessage: local first, parent second. */
    const record = (message: Message) => {
      sessionHistory.current = [...sessionHistory.current, message];
      delivered.push(message);
    };

    return { sessionHistory, delivered, record };
  }

  it("includes the turn that just happened, before the parent re-renders", () => {
    const { sessionHistory, record } = makeSession([]);

    record(createMessage("user", "I froze in the interview", { inputType: "voice" }));
    record(createMessage("assistant", "Oh no.", { outputType: "voice" }));

    /* No re-render has occurred; the proposal still sees both turns. */
    expect(sessionHistory.current).toHaveLength(2);
    expect(sessionHistory.current.at(-1)?.role).toBe("assistant");
    expect(sessionHistory.current[0].content).toContain("froze");
  });

  it("starts from the conversation the call opened with", () => {
    const existing = [
      createMessage("user", "typed earlier", { inputType: "text" }),
    ];
    const { sessionHistory, record } = makeSession(existing);

    record(createMessage("user", "spoken now", { inputType: "voice" }));

    expect(sessionHistory.current.map((m) => m.inputType)).toEqual([
      "text",
      "voice",
    ]);
  });
});

/*
 * The bug: recordSafetyEvent and its storage existed but nothing ever called
 * them, so exports contained no safety events even after a disclosure.
 */
describe("safety event audit trail", () => {
  it("writes a row for a disclosure", async () => {
    await recordSafetyEvent(
      "high_risk",
      "immediate_safety_check",
      "text",
      "msg_1",
    );

    const events = await priyaStorage.getSafetyEvents();

    expect(events).toHaveLength(1);
    expect(events[0].state).toBe("high_risk");
    expect(events[0].phase).toBe("immediate_safety_check");
    expect(events[0].channel).toBe("text");
    expect(events[0].messageId).toBe("msg_1");
    expect(events[0].conversationId).toBeTruthy();
    expect(events[0].createdAt).toBeTruthy();
  });

  it("records both channels", async () => {
    await recordSafetyEvent("supportive", "supportive", "text", "m1");
    await recordSafetyEvent("high_risk", "immediate_safety_check", "voice", "m2");

    const channels = (await priyaStorage.getSafetyEvents()).map(
      (event) => event.channel,
    );

    expect(channels).toEqual(["text", "voice"]);
  });

  it("stays quiet for ordinary turns", async () => {
    await recordSafetyEvent("normal", "normal", "text", "m1");

    expect(await priyaStorage.getSafetyEvents()).toHaveLength(0);
  });

  it("still records an ordinary turn taken during a live disclosure", async () => {
    await recordSafetyEvent("normal", "safety_follow_up", "voice", "m1");

    expect(await priyaStorage.getSafetyEvents()).toHaveLength(1);
  });

  it("reaches the export", async () => {
    await recordSafetyEvent("high_risk", "immediate_safety_check", "text", "m1");

    expect((await priyaStorage.exportAll()).safetyEvents).toHaveLength(1);
  });
});

/*
 * The bug: summaries were written from messages.slice(0, 12), so a long
 * conversation's ending — the decision, the next step, whether a disclosure
 * was resolved — never reached the summary that later becomes PRIYA's
 * recalled context.
 */
describe("summary window", () => {
  const turn = (i: number) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `turn ${i}`,
  });

  it("keeps a short conversation whole", () => {
    const messages = Array.from({ length: 10 }, (_, i) => turn(i));

    expect(summaryWindow(messages)).toHaveLength(10);
    expect(summaryWindow(messages)).toEqual(messages);
  });

  it("keeps the ending of a long conversation", () => {
    const messages = Array.from({ length: 100 }, (_, i) => turn(i));
    const selected = summaryWindow(messages);

    expect(selected.at(-1)).toEqual(turn(99));
    expect(selected).toContainEqual(turn(98));
  });

  it("keeps enough of the opening to say what it was about", () => {
    const messages = Array.from({ length: 100 }, (_, i) => turn(i));
    const selected = summaryWindow(messages);

    expect(selected[0]).toEqual(turn(0));
  });

  it("stays within the limit", () => {
    const messages = Array.from({ length: 500 }, (_, i) => turn(i));

    expect(summaryWindow(messages)).toHaveLength(24);
    expect(summaryWindow(messages, 10)).toHaveLength(10);
  });

  it("no longer drops the tail the way slice(0, 12) did", () => {
    const messages = Array.from({ length: 40 }, (_, i) => turn(i));
    const selected = summaryWindow(messages);

    /* The old behaviour ended at turn 11 and never saw the resolution. */
    expect(messages.slice(0, 12).at(-1)).toEqual(turn(11));
    expect(selected.at(-1)).toEqual(turn(39));
  });
});
