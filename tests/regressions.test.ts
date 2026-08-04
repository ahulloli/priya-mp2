import { beforeEach, describe, expect, it } from "vitest";

import {
  appendMessage,
  approveMemory,
  approvedMemoryText,
  clearAll,
  deleteMemory,
  editMemory,
  createMessage,
  flushWrites,
  isGreeting,
  readState,
  resetStore,
  setMode,
  updateConversation,
  recordSafetyEvent,
} from "@/lib/conversation-store";
import { priyaStorage } from "@/lib/storage";
import { canCreateSpokenResponse } from "@/lib/safety-phase";
import { summaryWindow } from "@/lib/summary-window";
import type { Message } from "@/types/chat";
import { SAFETY_PHASES, isActiveSafetyPhase } from "@/types/chat";

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

/*
 * The bug: syncInstructions returned void on every failure path, and
 * moderateThenRespond sent response.create regardless. On the turn a
 * disclosure was detected, the crisis instructions could fail to apply and
 * PRIYA would answer with the ordinary framing she already had.
 */
describe("spoken response gating", () => {
  it("stays silent when crisis instructions did not apply", () => {
    expect(canCreateSpokenResponse("immediate_safety_check", false)).toBe(
      false,
    );
    expect(canCreateSpokenResponse("safety_follow_up", false)).toBe(false);
  });

  it("speaks once the crisis instructions are in place", () => {
    expect(canCreateSpokenResponse("immediate_safety_check", true)).toBe(true);
    expect(canCreateSpokenResponse("safety_follow_up", true)).toBe(true);
  });

  it("does not silence ordinary conversation over a failed resync", () => {
    /* Stale framing on a normal turn is a nuisance, not a hazard. */
    expect(canCreateSpokenResponse("normal", false)).toBe(true);
    expect(canCreateSpokenResponse("supportive", false)).toBe(true);
    expect(canCreateSpokenResponse("resolved", false)).toBe(true);
  });

  it("covers every phase", () => {
    for (const phase of SAFETY_PHASES) {
      expect(canCreateSpokenResponse(phase, true)).toBe(true);
      expect(canCreateSpokenResponse(phase, false)).toBe(
        !isActiveSafetyPhase(phase),
      );
    }
  });
});

describe("safety event durability", () => {
  it("reports failure instead of losing the record silently", async () => {
    const original = priyaStorage.saveSafetyEvent;

    priyaStorage.saveSafetyEvent = async () => {
      throw new Error("network down");
    };

    const recorded = await recordSafetyEvent(
      "high_risk",
      "immediate_safety_check",
      "voice",
      "m1",
    );

    priyaStorage.saveSafetyEvent = original;

    expect(recorded).toBe(false);
  });

  it("recovers when a later attempt succeeds", async () => {
    const original = priyaStorage.saveSafetyEvent;
    let attempts = 0;

    priyaStorage.saveSafetyEvent = async (event) => {
      attempts += 1;

      if (attempts < 2) {
        throw new Error("transient");
      }

      return original.call(priyaStorage, event);
    };

    const recorded = await recordSafetyEvent(
      "high_risk",
      "immediate_safety_check",
      "text",
      "m1",
    );

    priyaStorage.saveSafetyEvent = original;

    expect(recorded).toBe(true);
    expect(attempts).toBeGreaterThan(1);
    expect(await priyaStorage.getSafetyEvents()).toHaveLength(1);
  });
});

/*
 * The bug: every conversation update fired an unawaited write. Against
 * localStorage that is invisible, because writes complete synchronously.
 * Against a database they are network requests, and two in flight can land
 * out of order — an older transcript arriving last and overwriting a newer
 * one.
 */
describe("conversation write ordering", () => {
  it("serialises writes even when the adapter resolves out of order", async () => {
    const original = priyaStorage.saveMessage;
    const completed: string[] = [];
    let call = 0;

    /* First write is slow, second is instant — the classic reordering case. */
    priyaStorage.saveMessage = async (message) => {
      const delay = call++ === 0 ? 40 : 0;

      await new Promise((resolve) => setTimeout(resolve, delay));
      completed.push(message.content);

      return original.call(priyaStorage, message);
    };

    appendMessage(createMessage("user", "first", { inputType: "text" }));
    appendMessage(createMessage("user", "second", { inputType: "text" }));

    await flushWrites();
    priyaStorage.saveMessage = original;

    /* Unqueued, "second" would have completed before "first". */
    expect(completed).toEqual(["first", "second"]);
  });

  it("keeps every message when writes are interleaved", async () => {
    appendMessage(createMessage("user", "one", { inputType: "text" }));
    appendMessage(createMessage("assistant", "two", { outputType: "text" }));
    appendMessage(createMessage("user", "three", { inputType: "voice" }));

    await flushWrites();

    const stored = await priyaStorage.getActiveConversation();
    const contents = stored!.messages
      .filter((message) => !isGreeting(message))
      .map((message) => message.content);

    expect(contents).toEqual(["one", "two", "three"]);
  });

  it("survives a failing write without losing the in-memory conversation", async () => {
    const original = priyaStorage.saveMessage;

    priyaStorage.saveMessage = async () => {
      throw new Error("network down");
    };

    appendMessage(createMessage("user", "still here", { inputType: "text" }));
    await flushWrites();

    priyaStorage.saveMessage = original;

    /* The queue must not be poisoned by one rejection. */
    appendMessage(createMessage("user", "and this", { inputType: "text" }));
    await flushWrites();

    const stored = await priyaStorage.getActiveConversation();

    expect(
      stored!.messages.some((message) => message.content === "and this"),
    ).toBe(true);
  });
});

/*
 * The bug: a failed write only reached console.error. The conversation still
 * looked saved on screen, so the person believed it was stored when it was
 * not — the worst of the possible outcomes.
 */
describe("storage failure is visible", () => {
  it("reports a failed write instead of pretending it saved", async () => {
    const original = priyaStorage.saveMessage;

    priyaStorage.saveMessage = async () => {
      throw new Error("network down");
    };

    appendMessage(createMessage("user", "did this save?", { inputType: "text" }));
    await flushWrites();

    priyaStorage.saveMessage = original;

    expect(readState().writeError).toBeTruthy();
    expect(readState().writeError).toMatch(/couldn’t save/i);
  });

  it("clears the warning once a later write succeeds", async () => {
    const original = priyaStorage.saveMessage;

    priyaStorage.saveMessage = async () => {
      throw new Error("network down");
    };

    appendMessage(createMessage("user", "first", { inputType: "text" }));
    await flushWrites();
    expect(readState().writeError).toBeTruthy();

    priyaStorage.saveMessage = original;

    appendMessage(createMessage("user", "second", { inputType: "text" }));
    await flushWrites();

    expect(readState().writeError).toBeNull();
  });
});

/*
 * Item 7 of the verification plan: ten rapid messages, and the stored order
 * must match what the interface showed. The queue is what guarantees this —
 * unserialised writes would land in completion order, not send order.
 */
describe("rapid message ordering", () => {
  it("stores ten quick messages in the order they were sent", async () => {
    const sent = Array.from({ length: 10 }, (_, i) => `message ${i}`);

    for (const content of sent) {
      appendMessage(createMessage("user", content, { inputType: "text" }));
    }

    await flushWrites();

    const stored = await priyaStorage.getActiveConversation();
    const contents = stored!.messages
      .filter((message) => !isGreeting(message))
      .map((message) => message.content);

    expect(contents).toEqual(sent);
  });

  it("keeps stored order matching the in-memory order", async () => {
    for (let i = 0; i < 10; i += 1) {
      appendMessage(createMessage("user", `m${i}`, { inputType: "text" }));
    }

    await flushWrites();

    const onScreen = readState()
      .conversation!.messages.filter((m) => !isGreeting(m))
      .map((m) => m.id);
    const stored = (await priyaStorage.getActiveConversation())!.messages
      .filter((m) => !isGreeting(m))
      .map((m) => m.id);

    expect(stored).toEqual(onScreen);
  });

  it("timestamps never go backwards", async () => {
    for (let i = 0; i < 10; i += 1) {
      appendMessage(createMessage("user", `t${i}`, { inputType: "text" }));
    }

    await flushWrites();

    const times = (await priyaStorage.getActiveConversation())!.messages.map(
      (m) => Date.parse(m.createdAt),
    );

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("memory edits", () => {
  it("moves updatedAt forward without touching createdAt", async () => {
    await approveMemory("You have a cat.");
    const [before] = await priyaStorage.getMemories();

    /* Timestamps are millisecond-resolution ISO strings. */
    await new Promise((resolve) => setTimeout(resolve, 5));
    await editMemory(before.id, "You have two cats.");

    const [after] = await priyaStorage.getMemories();

    expect(after.summary).toBe("You have two cats.");
    expect(after.createdAt).toBe(before.createdAt);
    expect(Date.parse(after.updatedAt)).toBeGreaterThan(
      Date.parse(before.updatedAt),
    );
  });

  it("stops influencing PRIYA once deleted", async () => {
    await approveMemory("You have a cat.");
    const [memory] = await priyaStorage.getMemories();

    expect(approvedMemoryText(await priyaStorage.getMemories())).toContain(
      "You have a cat.",
    );

    await deleteMemory(memory.id);

    expect(approvedMemoryText(await priyaStorage.getMemories())).toEqual([]);
  });
});

/*
 * The bug: the store is a module singleton and `hydrated` was never reset, so
 * signing out as one person and in as another on the same tab left the first
 * person's conversation, memories and archive on screen. RLS kept the database
 * safe; the interface was not.
 */
describe("store isolation between accounts", () => {
  it("drops the previous account's data when the user changes", async () => {
    appendMessage(createMessage("user", "A's private thought", { inputType: "text" }));
    await approveMemory("A has a cat.");
    await flushWrites();

    expect(readState().conversation!.messages.some((m) => m.content.includes("A's private"))).toBe(true);
    expect(readState().memories).toHaveLength(1);

    resetStore();

    expect(readState().conversation).toBeNull();
    expect(readState().memories).toEqual([]);
    expect(readState().archive).toEqual([]);
    expect(readState().feedback).toEqual([]);
  });

  it("clears the write warning along with everything else", async () => {
    const original = priyaStorage.saveMessage;
    priyaStorage.saveMessage = async () => { throw new Error("down"); };

    appendMessage(createMessage("user", "unsaved", { inputType: "text" }));
    await flushWrites();
    expect(readState().writeError).toBeTruthy();

    priyaStorage.saveMessage = original;
    resetStore();

    expect(readState().writeError).toBeNull();
  });
});

/*
 * The bug: splitting persistence into metadata and per-message writes left a
 * trap. A caller that added a message through updateConversation got the
 * conversation row updated and the message silently dropped. Every user
 * message went that way, so the database held only PRIYA's replies — the
 * transcript on screen looked complete and the stored one was half missing.
 */
describe("every message reaches storage", () => {
  it("persists a message added through updateConversation", async () => {
    const message = createMessage("user", "typed by hand", {
      inputType: "text",
    });

    updateConversation((current) => ({
      ...current,
      messages: [...current.messages, message],
    }));

    await flushWrites();

    const stored = await priyaStorage.getActiveConversation();

    expect(stored!.messages.some((m) => m.id === message.id)).toBe(true);
  });

  it("stores both halves of an exchange", async () => {
    appendMessage(createMessage("user", "I feel stuck", { inputType: "text" }));
    appendMessage(
      createMessage("assistant", "Say more?", { outputType: "text" }),
    );

    await flushWrites();

    const roles = (await priyaStorage.getActiveConversation())!.messages
      .filter((m) => !isGreeting(m))
      .map((m) => m.role);

    /* The failure looked exactly like this list missing "user". */
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("does not rewrite a message that was already stored", async () => {
    const message = createMessage("user", "once", { inputType: "text" });

    appendMessage(message);
    await flushWrites();

    /* A later metadata change must not duplicate it. */
    setMode("plan");
    await flushWrites();

    const stored = await priyaStorage.getActiveConversation();
    const matches = stored!.messages.filter((m) => m.id === message.id);

    expect(matches).toHaveLength(1);
  });
});
