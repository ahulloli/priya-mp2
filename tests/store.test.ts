import { beforeEach, describe, expect, it } from "vitest";

import {
  approveMemory,
  approvedMemoryText,
  appendMessage,
  clearAll,
  createMessage,
  deleteMemory,
  flushWrites,
  editMemory,
  recalledConversations,
  resetConversation,
  saveFeedback,
  setSafetyPhase,
  usePriyaStore,
} from "@/lib/conversation-store";
import { priyaStorage } from "@/lib/storage";
import type { Conversation } from "@/types/chat";

/*
 * usePriyaStore is a hook, but the store underneath is a module singleton, so
 * the behaviour can be driven directly. Reading state back goes through
 * storage, which is the contract that matters.
 */

beforeEach(async () => {
  await clearAll();
  /* clearAll rehydrates asynchronously; let it settle. */
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe("memory approval", () => {
  it("stores nothing until something is explicitly approved", async () => {
    expect(await priyaStorage.getMemories()).toHaveLength(0);

    await approveMemory("You have a cat.", "general");

    const stored = await priyaStorage.getMemories();

    expect(stored).toHaveLength(1);
    expect(stored[0].approved).toBe(true);
    expect(stored[0].summary).toBe("You have a cat.");
  });

  it("refuses to store an empty approval", async () => {
    await approveMemory("   ");

    expect(await priyaStorage.getMemories()).toHaveLength(0);
  });

  it("edits and deletes approved memories", async () => {
    await approveMemory("You have a cat.");
    const [stored] = await priyaStorage.getMemories();

    await editMemory(stored.id, "You have two cats.");
    expect((await priyaStorage.getMemories())[0].summary).toBe(
      "You have two cats.",
    );

    await deleteMemory(stored.id);
    expect(await priyaStorage.getMemories()).toHaveLength(0);
  });

  it("only sends approved memories to the model", () => {
    const now = new Date().toISOString();
    const base = { category: "general" as const, createdAt: now, updatedAt: now };

    expect(
      approvedMemoryText([
        { id: "1", summary: "approved", approved: true, ...base },
        { id: "2", summary: "not approved", approved: false, ...base },
      ]),
    ).toEqual(["approved"]);
  });
});

describe("messages", () => {
  it("stamps every message with its conversation and phase", async () => {
    setSafetyPhase("safety_follow_up");

    const message = createMessage("user", "hello", { inputType: "voice" });

    expect(message.conversationId).toMatch(/^conv_/);
    expect(message.safetyPhase).toBe("safety_follow_up");
    expect(message.inputType).toBe("voice");
    expect(message.interrupted).toBe(false);
    expect(message.createdAt).toBeTruthy();
  });

  it("marks an interrupted response", () => {
    const message = createMessage("assistant", "here are three—", {
      outputType: "voice",
      interrupted: true,
    });

    expect(message.interrupted).toBe(true);
    expect(message.outputType).toBe("voice");
  });

  it("keeps text and voice in one conversation", async () => {
    appendMessage(createMessage("user", "typed", { inputType: "text" }));
    appendMessage(createMessage("user", "spoken", { inputType: "voice" }));

    /* Writes are queued now, so wait for them to land. */
    await flushWrites();

    const active = await priyaStorage.getActiveConversation();
    const said = active!.messages.filter((m) => m.role === "user");

    expect(said).toHaveLength(2);
    expect(new Set(said.map((m) => m.conversationId)).size).toBe(1);
    expect(said.map((m) => m.inputType)).toEqual(["text", "voice"]);
  });
});

describe("feedback scoping", () => {
  it("attaches feedback to the conversation it was given in", async () => {
    appendMessage(createMessage("user", "first", { inputType: "text" }));
    await flushWrites();
    const first = (await priyaStorage.getActiveConversation())!.id;

    await saveFeedback({ feltUnderstood: 5, helpful: 4, hasNextStep: true });

    await resetConversation("listen");
    appendMessage(createMessage("user", "second", { inputType: "text" }));
    await flushWrites();
    const second = (await priyaStorage.getActiveConversation())!.id;

    await saveFeedback({ feltUnderstood: 2, helpful: 2, hasNextStep: false });

    const all = await priyaStorage.getFeedback();

    expect(first).not.toBe(second);
    expect(all).toHaveLength(2);
    expect(all.filter((f) => f.conversationId === first)).toHaveLength(1);
    expect(all.filter((f) => f.conversationId === second)).toHaveLength(1);
  });
});

describe("recall", () => {
  const base = {
    mode: "listen" as const,
    safetyPhase: "normal" as const,
    messages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date().toISOString(),
  };

  it("only offers conversations that were actually summarised", () => {
    const archive: Conversation[] = [
      { ...base, id: "a", title: "Titled", summary: "A summary." },
      { ...base, id: "b", title: "Titled but unsummarised" },
      { ...base, id: "c", summary: "Summary with no title" },
    ];

    const recalled = recalledConversations(archive);

    expect(recalled).toHaveLength(1);
    expect(recalled[0].title).toBe("Titled");
  });

  it("caps how much rides along on every turn", () => {
    const archive: Conversation[] = Array.from({ length: 30 }, (_, i) => ({
      ...base,
      id: `c${i}`,
      title: `Conversation ${i}`,
      summary: "A summary.",
    }));

    expect(recalledConversations(archive)).toHaveLength(12);
    expect(recalledConversations(archive, 3)).toHaveLength(3);
  });
});

describe("exports", () => {
  it("hooks are exported for the UI to consume", () => {
    expect(typeof usePriyaStore).toBe("function");
  });
});
