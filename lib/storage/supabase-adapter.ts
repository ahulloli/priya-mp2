import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
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

/*
 * Postgres-backed storage.
 *
 * Every write carries user_id explicitly. Row Level Security would reject a
 * mismatched one anyway, but sending it makes the ownership visible at the
 * call site rather than implied by policy.
 *
 * snake_case lives here and nowhere else — the application is camelCase
 * throughout, and this file is the only translation layer.
 */

type ConversationRow = {
  id: string;
  mode: Conversation["mode"];
  title: string | null;
  summary: string | null;
  safety_phase: Conversation["safetyPhase"];
  created_at: string;
  updated_at: string;
  ended_at: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: Message["role"];
  content: string;
  input_type: Message["inputType"] | null;
  output_type: Message["outputType"] | null;
  interrupted: boolean;
  safety_phase: Message["safetyPhase"];
  created_at: string;
};

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    inputType: row.input_type ?? undefined,
    outputType: row.output_type ?? undefined,
    interrupted: row.interrupted,
    safetyPhase: row.safety_phase,
    createdAt: row.created_at,
  };
}

function toConversation(
  row: ConversationRow,
  messages: Message[],
): Conversation {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title ?? undefined,
    summary: row.summary ?? undefined,
    messages,
    safetyPhase: row.safety_phase,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
  };
}

export class SupabaseStorageAdapter implements PriyaStorage {
  private supabase: SupabaseClient;
  private cachedUserId: string | null = null;

  constructor(client: SupabaseClient = createClient()) {
    this.supabase = client;
  }

  /** Throws rather than writing an unowned row when nobody is signed in. */
  private async userId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    const {
      data: { user },
    } = await this.supabase.auth.getUser();

    if (!user) {
      throw new Error("Not signed in.");
    }

    this.cachedUserId = user.id;

    return user.id;
  }

  private async messagesFor(conversationId: string): Promise<Message[]> {
    const { data, error } = await this.supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data as MessageRow[]).map(toMessage);
  }

  async getActiveConversation(): Promise<Conversation | null> {
    const { data, error } = await this.supabase
      .from("conversations")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    const row = data as ConversationRow;

    return toConversation(row, await this.messagesFor(row.id));
  }

  async setActiveConversation(
    conversation: Conversation | null,
  ): Promise<void> {
    const userId = await this.userId();

    /*
     * A partial unique index allows only one active conversation per user, so
     * the old one has to be stood down before the new one is raised.
     */
    const { error: clearError } = await this.supabase
      .from("conversations")
      .update({ is_active: false })
      .eq("user_id", userId)
      .eq("is_active", true);

    if (clearError) {
      throw clearError;
    }

    if (!conversation) {
      return;
    }

    await this.upsertConversation(conversation, userId, true);
    await this.upsertMessages(conversation.messages, userId);
  }

  private async upsertConversation(
    conversation: Conversation,
    userId: string,
    isActive: boolean,
  ): Promise<void> {
    const { error } = await this.supabase.from("conversations").upsert({
      id: conversation.id,
      user_id: userId,
      mode: conversation.mode,
      title: conversation.title ?? null,
      summary: conversation.summary ?? null,
      safety_phase: conversation.safetyPhase,
      is_active: isActive,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt,
      ended_at: conversation.endedAt ?? null,
    });

    if (error) {
      throw error;
    }
  }

  private async upsertMessages(
    messages: Message[],
    userId: string,
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const { error } = await this.supabase.from("messages").upsert(
      messages.map((message) => ({
        id: message.id,
        conversation_id: message.conversationId,
        user_id: userId,
        role: message.role,
        content: message.content,
        input_type: message.inputType ?? null,
        output_type: message.outputType ?? null,
        interrupted: message.interrupted,
        safety_phase: message.safetyPhase,
        created_at: message.createdAt,
      })),
    );

    if (error) {
      throw error;
    }
  }

  async getConversations(): Promise<Conversation[]> {
    const { data, error } = await this.supabase
      .from("conversations")
      .select("*")
      .eq("is_active", false)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    const rows = data as ConversationRow[];

    /*
     * Archived conversations are listed for their titles and summaries; the
     * transcript is only needed when one is reopened, and fetching every
     * message for every archived conversation would be wasteful.
     */
    return rows.map((row) => toConversation(row, []));
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const userId = await this.userId();

    await this.upsertConversation(conversation, userId, false);
    await this.upsertMessages(conversation.messages, userId);
  }

  async saveConversationMetadata(conversation: Conversation): Promise<void> {
    const userId = await this.userId();
    const { error } = await this.supabase
      .from("conversations")
      .update({
        mode: conversation.mode,
        title: conversation.title ?? null,
        summary: conversation.summary ?? null,
        safety_phase: conversation.safetyPhase,
        updated_at: conversation.updatedAt,
        ended_at: conversation.endedAt ?? null,
      })
      .eq("id", conversation.id)
      .eq("user_id", userId);

    if (error) {
      throw error;
    }
  }

  async saveMessage(message: Message): Promise<void> {
    await this.upsertMessages([message], await this.userId());
  }

  async deleteConversation(id: string): Promise<void> {
    /* Messages, feedback, reports and safety events cascade. */
    const { error } = await this.supabase
      .from("conversations")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  async getMemories(): Promise<Memory[]> {
    const { data, error } = await this.supabase
      .from("memories")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      summary: row.summary,
      category: row.category,
      approved: row.approved,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async saveMemory(memory: Memory): Promise<void> {
    const { error } = await this.supabase.from("memories").insert({
      id: memory.id,
      user_id: await this.userId(),
      summary: memory.summary,
      category: memory.category,
      approved: memory.approved,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt,
    });

    if (error) {
      throw error;
    }
  }

  async updateMemory(memory: Memory): Promise<void> {
    const { error } = await this.supabase
      .from("memories")
      .update({
        summary: memory.summary,
        category: memory.category,
        approved: memory.approved,
        updated_at: memory.updatedAt,
      })
      .eq("id", memory.id);

    if (error) {
      throw error;
    }
  }

  async deleteMemory(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("memories")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }
  }

  async getFeedback(): Promise<Feedback[]> {
    const { data, error } = await this.supabase.from("feedback").select("*");

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      feltUnderstood: row.felt_understood,
      helpful: row.helpful,
      hasNextStep: row.has_next_step,
      comments: row.comments ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async saveFeedback(feedback: Feedback): Promise<void> {
    const { error } = await this.supabase.from("feedback").insert({
      id: feedback.id,
      conversation_id: feedback.conversationId,
      user_id: await this.userId(),
      felt_understood: feedback.feltUnderstood,
      helpful: feedback.helpful,
      has_next_step: feedback.hasNextStep,
      comments: feedback.comments ?? null,
      created_at: feedback.createdAt,
    });

    if (error) {
      throw error;
    }
  }

  async getReports(): Promise<Report[]> {
    const { data, error } = await this.supabase.from("reports").select("*");

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      content: row.content,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  async saveReport(report: Report): Promise<void> {
    const { error } = await this.supabase.from("reports").insert({
      id: report.id,
      conversation_id: report.conversationId,
      user_id: await this.userId(),
      message_id: report.messageId,
      content: report.content,
      reason: report.reason,
      created_at: report.createdAt,
    });

    if (error) {
      throw error;
    }
  }

  async getSafetyEvents(): Promise<SafetyEvent[]> {
    const { data, error } = await this.supabase
      .from("safety_events")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      messageId: row.message_id ?? undefined,
      state: row.state,
      phase: row.phase,
      channel: row.channel,
      createdAt: row.created_at,
    }));
  }

  async saveSafetyEvent(event: SafetyEvent): Promise<void> {
    const { error } = await this.supabase.from("safety_events").insert({
      id: event.id,
      conversation_id: event.conversationId,
      user_id: await this.userId(),
      message_id: event.messageId ?? null,
      state: event.state,
      phase: event.phase,
      channel: event.channel,
      created_at: event.createdAt,
    });

    if (error) {
      throw error;
    }
  }

  async getVoicePreference(): Promise<VoicePreference> {
    const { data, error } = await this.supabase
      .from("voice_preferences")
      .select("*")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return DEFAULT_VOICE_PREFERENCE;
    }

    return {
      id: data.user_id,
      voice: data.voice,
      pace: Number(data.pace),
      warmth: data.warmth,
      directness: data.directness,
      energy: data.energy,
      responseLength: data.response_length,
      silenceMs: data.silence_ms,
      useName: data.use_name,
      name: data.name ?? undefined,
      updatedAt: data.updated_at,
    };
  }

  async saveVoicePreference(preference: VoicePreference): Promise<void> {
    const { error } = await this.supabase.from("voice_preferences").upsert({
      user_id: await this.userId(),
      voice: preference.voice,
      pace: preference.pace,
      warmth: preference.warmth,
      directness: preference.directness,
      energy: preference.energy,
      response_length: preference.responseLength,
      silence_ms: preference.silenceMs,
      use_name: preference.useName,
      name: preference.name ?? null,
      updated_at: preference.updatedAt,
    });

    if (error) {
      throw error;
    }
  }

  async exportAll(): Promise<PriyaExport> {
    const active = await this.getActiveConversation();
    const archived = await this.getConversations();

    /* The archive list carries no messages, so fetch them for the export. */
    const withMessages = await Promise.all(
      archived.map(async (conversation) => ({
        ...conversation,
        messages: await this.messagesFor(conversation.id),
      })),
    );

    const conversations = active ? [active, ...withMessages] : withMessages;

    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      conversations,
      messages: conversations.flatMap((entry) => entry.messages),
      memories: await this.getMemories(),
      feedback: await this.getFeedback(),
      reports: await this.getReports(),
      safetyEvents: await this.getSafetyEvents(),
      voicePreferences: [await this.getVoicePreference()],
    };
  }

  async clearAll(): Promise<void> {
    const userId = await this.userId();

    /* Messages, feedback, reports and safety events cascade from here. */
    await this.supabase.from("conversations").delete().eq("user_id", userId);
    await this.supabase.from("memories").delete().eq("user_id", userId);
    await this.supabase
      .from("voice_preferences")
      .delete()
      .eq("user_id", userId);

    if (typeof window !== "undefined") {
      window.sessionStorage.clear();
    }
  }
}
