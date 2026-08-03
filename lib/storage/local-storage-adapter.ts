import type {
  Conversation,
  Feedback,
  Memory,
  Message,
  PriyaExport,
  Report,
  SafetyEvent,
  VoicePreference,
} from "@/types/chat";
import { DEFAULT_VOICE_PREFERENCE } from "@/types/chat";

import type { PriyaStorage } from "./types";

const KEYS = {
  active: "priya.conversation",
  conversations: "priya.conversations",
  memories: "priya.memories",
  preference: "priya.voicePreferences",
  feedback: "priya.feedback",
  reports: "priya.reports",
  safetyEvents: "priya.safetyEvents",
} as const;

/*
 * Records written before the shapes were finalised used snake_case on messages
 * and `conversation_id` on conversations. Migrating on read means a tester's
 * existing data survives rather than silently disappearing.
 */
type LegacyMessage = Partial<Message> & {
  input_type?: Message["inputType"];
  output_type?: Message["outputType"];
  safety_phase?: Message["safetyPhase"];
};

type LegacyConversation = Omit<Partial<Conversation>, "messages"> & {
  conversation_id?: string;
  messages?: LegacyMessage[];
};

function migrateConversation(raw: LegacyConversation): Conversation | null {
  const id = raw.id ?? raw.conversation_id;

  if (!id || !Array.isArray(raw.messages)) {
    return null;
  }

  const now = new Date().toISOString();

  return {
    id,
    mode: raw.mode ?? "listen",
    title: raw.title,
    summary: raw.summary,
    safetyPhase: raw.safetyPhase ?? "normal",
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
    endedAt: raw.endedAt,
    messages: raw.messages.map((message, index) => ({
      id: message.id ?? `msg_${id}_${index}`,
      conversationId: id,
      role: message.role ?? "assistant",
      content: message.content ?? "",
      inputType: message.inputType ?? message.input_type,
      outputType: message.outputType ?? message.output_type,
      interrupted: message.interrupted ?? false,
      safetyPhase: message.safetyPhase ?? "normal",
      createdAt: message.createdAt ?? raw.createdAt ?? now,
    })),
  };
}

type LegacyMemory = Partial<Memory>;

function migrateMemory(raw: LegacyMemory): Memory | null {
  if (!raw.id || !raw.summary) {
    return null;
  }

  const created = raw.createdAt ?? new Date().toISOString();

  return {
    id: raw.id,
    summary: raw.summary,
    category: raw.category ?? "general",
    approved: raw.approved ?? true,
    createdAt: created,
    updatedAt: raw.updatedAt ?? created,
  };
}

type LegacyScoped = { conversation_id?: string; conversationId?: string };

function migrateScoped<T extends LegacyScoped>(
  raw: T,
): T & { conversationId: string } {
  return {
    ...raw,
    conversationId: raw.conversationId ?? raw.conversation_id ?? "unknown",
  };
}

/**
 * The prototype's storage: synchronous localStorage behind an async interface.
 * Everything is scoped to one browser and one device, with no account — which
 * is exactly why this is the piece Supabase replaces.
 */
export class LocalStorageAdapter implements PriyaStorage {
  private read<T>(key: string, fallback: T): T {
    if (typeof window === "undefined") {
      return fallback;
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      /* Corrupt or unavailable storage shouldn't take the app down. */
      return fallback;
    }
  }

  private write(key: string, value: unknown): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Quota or private-mode failures are non-fatal. */
    }
  }

  async getActiveConversation(): Promise<Conversation | null> {
    const raw = this.read<LegacyConversation | null>(KEYS.active, null);

    return raw ? migrateConversation(raw) : null;
  }

  async setActiveConversation(
    conversation: Conversation | null,
  ): Promise<void> {
    if (conversation === null) {
      window?.localStorage?.removeItem(KEYS.active);
      return;
    }

    this.write(KEYS.active, conversation);
  }

  async getConversations(): Promise<Conversation[]> {
    return this.read<LegacyConversation[]>(KEYS.conversations, [])
      .map(migrateConversation)
      .filter((entry): entry is Conversation => entry !== null);
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const existing = await this.getConversations();
    const index = existing.findIndex((entry) => entry.id === conversation.id);

    if (index >= 0) {
      existing[index] = conversation;
    } else {
      existing.unshift(conversation);
    }

    this.write(KEYS.conversations, existing.slice(0, 100));
  }

  async deleteConversation(id: string): Promise<void> {
    const remaining = (await this.getConversations()).filter(
      (entry) => entry.id !== id,
    );

    this.write(KEYS.conversations, remaining);
  }

  async getMemories(): Promise<Memory[]> {
    return this.read<LegacyMemory[]>(KEYS.memories, [])
      .map(migrateMemory)
      .filter((entry): entry is Memory => entry !== null);
  }

  async saveMemory(memory: Memory): Promise<void> {
    this.write(KEYS.memories, [...(await this.getMemories()), memory]);
  }

  async updateMemory(memory: Memory): Promise<void> {
    const memories = (await this.getMemories()).map((entry) =>
      entry.id === memory.id ? memory : entry,
    );

    this.write(KEYS.memories, memories);
  }

  async deleteMemory(id: string): Promise<void> {
    const memories = (await this.getMemories()).filter(
      (entry) => entry.id !== id,
    );

    this.write(KEYS.memories, memories);
  }

  async getFeedback(): Promise<Feedback[]> {
    return this.read<Feedback[]>(KEYS.feedback, []).map(migrateScoped);
  }

  async saveFeedback(feedback: Feedback): Promise<void> {
    this.write(KEYS.feedback, [...(await this.getFeedback()), feedback]);
  }

  async getReports(): Promise<Report[]> {
    return this.read<Report[]>(KEYS.reports, []).map(migrateScoped);
  }

  async saveReport(report: Report): Promise<void> {
    this.write(KEYS.reports, [...(await this.getReports()), report]);
  }

  async getSafetyEvents(): Promise<SafetyEvent[]> {
    return this.read<SafetyEvent[]>(KEYS.safetyEvents, []);
  }

  async saveSafetyEvent(event: SafetyEvent): Promise<void> {
    const events = [...(await this.getSafetyEvents()), event];

    this.write(KEYS.safetyEvents, events.slice(-500));
  }

  async getVoicePreference(): Promise<VoicePreference> {
    return {
      ...DEFAULT_VOICE_PREFERENCE,
      ...this.read<Partial<VoicePreference>>(KEYS.preference, {}),
    };
  }

  async saveVoicePreference(preference: VoicePreference): Promise<void> {
    this.write(KEYS.preference, preference);
  }

  async exportAll(): Promise<PriyaExport> {
    const active = await this.getActiveConversation();
    const archived = await this.getConversations();
    const conversations = active ? [active, ...archived] : archived;

    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      conversations,
      /* Flattened as their own rows, matching the future messages table. */
      messages: conversations.flatMap(
        (conversation) => conversation.messages,
      ),
      memories: await this.getMemories(),
      feedback: await this.getFeedback(),
      reports: await this.getReports(),
      safetyEvents: await this.getSafetyEvents(),
      voicePreferences: [await this.getVoicePreference()],
    };
  }

  async clearAll(): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }

    Object.values(KEYS).forEach((key) =>
      window.localStorage.removeItem(key),
    );
    window.sessionStorage.clear();
  }
}
