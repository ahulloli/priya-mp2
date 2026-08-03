import type {
  Conversation,
  Message,
  Feedback,
  Memory,
  PriyaExport,
  Report,
  SafetyEvent,
  VoicePreference,
} from "@/types/chat";

/**
 * Everything the app is allowed to do to persisted data. Components and the
 * store talk to this and never to localStorage, so swapping in Supabase means
 * writing one more implementation rather than touching the UI.
 *
 * Every method is async even though the local adapter is synchronous
 * underneath — otherwise the signatures would have to change the day a
 * network-backed adapter arrives, which is exactly the rewrite this exists to
 * avoid.
 */
export interface PriyaStorage {
  /** The conversation currently being had, if any. */
  getActiveConversation(): Promise<Conversation | null>;
  setActiveConversation(conversation: Conversation | null): Promise<void>;

  /** Finished conversations, newest first. */
  getConversations(): Promise<Conversation[]>;
  saveConversation(conversation: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  /*
   * Granular writes, so a network adapter never has to replace an entire
   * transcript to record one turn. Rewriting the whole conversation on every
   * message is safe against localStorage and dangerous against a database:
   * two in-flight writes can land out of order and the older one wins,
   * silently dropping the newer messages.
   */

  /** Mode, title, summary, safety phase — everything except the messages. */
  saveConversationMetadata(conversation: Conversation): Promise<void>;
  /** Upsert one message by its stable id. */
  saveMessage(message: Message): Promise<void>;

  getMemories(): Promise<Memory[]>;
  saveMemory(memory: Memory): Promise<void>;
  updateMemory(memory: Memory): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  getFeedback(): Promise<Feedback[]>;
  saveFeedback(feedback: Feedback): Promise<void>;

  getReports(): Promise<Report[]>;
  saveReport(report: Report): Promise<void>;

  getSafetyEvents(): Promise<SafetyEvent[]>;
  saveSafetyEvent(event: SafetyEvent): Promise<void>;

  getVoicePreference(): Promise<VoicePreference>;
  saveVoicePreference(preference: VoicePreference): Promise<void>;

  /** Development tools: take everything out, or wipe it. */
  exportAll(): Promise<PriyaExport>;
  clearAll(): Promise<void>;
}
