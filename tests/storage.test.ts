import { beforeEach, describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "@/lib/storage/local-storage-adapter";
import type { Conversation, Feedback, Memory } from "@/types/chat";

const storage = new LocalStorageAdapter();

function conversation(id: string): Conversation {
  const now = new Date().toISOString();

  return {
    id,
    mode: "listen",
    safetyPhase: "normal",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        id: `${id}-m1`,
        conversationId: id,
        role: "user",
        content: "hello",
        inputType: "text",
        interrupted: false,
        safetyPhase: "normal",
        createdAt: now,
      },
    ],
  };
}

function memory(id: string, summary: string): Memory {
  const now = new Date().toISOString();

  return {
    id,
    summary,
    category: "general",
    approved: true,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(async () => {
  await storage.clearAll();
});

describe("LocalStorageAdapter", () => {
  it("round-trips a conversation", async () => {
    await storage.saveConversation(conversation("conv_1"));

    const all = await storage.getConversations();

    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("conv_1");
    expect(all[0].messages[0].conversationId).toBe("conv_1");
  });

  it("updates rather than duplicating on repeat save", async () => {
    await storage.saveConversation(conversation("conv_1"));
    await storage.saveConversation({
      ...conversation("conv_1"),
      title: "Named now",
    });

    const all = await storage.getConversations();

    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Named now");
  });

  it("deletes conversations", async () => {
    await storage.saveConversation(conversation("conv_1"));
    await storage.deleteConversation("conv_1");

    expect(await storage.getConversations()).toHaveLength(0);
  });

  it("creates, edits, and deletes memories", async () => {
    await storage.saveMemory(memory("mem_1", "Has a cat."));
    expect(await storage.getMemories()).toHaveLength(1);

    await storage.updateMemory({
      ...memory("mem_1", "Has two cats."),
    });
    expect((await storage.getMemories())[0].summary).toBe("Has two cats.");

    await storage.deleteMemory("mem_1");
    expect(await storage.getMemories()).toHaveLength(0);
  });

  it("migrates records written before the shapes were finalised", async () => {
    /* Old shape: conversation_id, snake_case message fields, no ids. */
    window.localStorage.setItem(
      "priya.conversation",
      JSON.stringify({
        conversation_id: "conv_old",
        mode: "plan",
        messages: [
          { role: "user", content: "hi", input_type: "voice" },
          { role: "assistant", content: "hello", output_type: "voice" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const migrated = await storage.getActiveConversation();

    expect(migrated?.id).toBe("conv_old");
    expect(migrated?.safetyPhase).toBe("normal");
    expect(migrated?.messages[0].inputType).toBe("voice");
    expect(migrated?.messages[1].outputType).toBe("voice");
    expect(migrated?.messages[0].conversationId).toBe("conv_old");
    expect(migrated?.messages[0].id).toBeTruthy();
    expect(migrated?.messages[0].interrupted).toBe(false);
  });

  it("exports every record type with messages flattened", async () => {
    await storage.setActiveConversation(conversation("conv_active"));
    await storage.saveConversation(conversation("conv_old"));
    await storage.saveMemory(memory("mem_1", "Has a cat."));
    await storage.saveFeedback({
      id: "fb_1",
      conversationId: "conv_active",
      feltUnderstood: 5,
      helpful: 4,
      hasNextStep: true,
      createdAt: new Date().toISOString(),
    } satisfies Feedback);

    const dump = await storage.exportAll();

    expect(dump.version).toBe(1);
    expect(dump.conversations).toHaveLength(2);
    expect(dump.messages).toHaveLength(2);
    expect(dump.memories).toHaveLength(1);
    expect(dump.feedback).toHaveLength(1);
    expect(dump.voicePreferences).toHaveLength(1);
    expect(dump.messages.every((message) => message.conversationId)).toBe(
      true,
    );
  });

  it("clears everything", async () => {
    await storage.saveConversation(conversation("conv_1"));
    await storage.saveMemory(memory("mem_1", "Has a cat."));

    await storage.clearAll();

    expect(await storage.getConversations()).toHaveLength(0);
    expect(await storage.getMemories()).toHaveLength(0);
    expect(await storage.getActiveConversation()).toBeNull();
  });

  it("survives corrupt stored JSON rather than throwing", async () => {
    window.localStorage.setItem("priya.memories", "{not json");

    expect(await storage.getMemories()).toEqual([]);
  });
});
