/*
 * The application's data shapes, finalised ahead of Supabase.
 *
 * Rules that hold across every record here:
 *   - a stable `id`
 *   - `conversationId` on anything belonging to a conversation
 *   - ISO `createdAt`, plus `updatedAt` where a record can change
 *   - camelCase throughout; the storage adapter owns any snake_case mapping
 */

export type PriyaMode = "listen" | "understand" | "similar" | "plan";

export const PRIYA_MODES: PriyaMode[] = [
  "listen",
  "understand",
  "similar",
  "plan",
];

/** What the classifier says about a single message. */
export type SafetyState = "normal" | "supportive" | "high_risk";

/**
 * Where the conversation is, which is not the same question. One phase, stored
 * on the conversation and shared by text and voice, so the two channels cannot
 * drift apart about whether a disclosure happened.
 *
 *   normal ──classifier high_risk──> immediate_safety_check
 *   immediate_safety_check ──next turn──> safety_follow_up
 *   safety_follow_up ──stays until the user says they're okay──> resolved
 *
 * Only the user resolves it. Hiding the crisis panel does not.
 */
export type SafetyPhase =
  | "normal"
  | "supportive"
  | "immediate_safety_check"
  | "safety_follow_up"
  | "resolved";

export const SAFETY_PHASES: SafetyPhase[] = [
  "normal",
  "supportive",
  "immediate_safety_check",
  "safety_follow_up",
  "resolved",
];

/** Phases where PRIYA is still holding a disclosure. */
export function isActiveSafetyPhase(phase: SafetyPhase): boolean {
  return phase === "immediate_safety_check" || phase === "safety_follow_up";
}

/** Voice is just another format. The conversation stays text internally. */
export type Channel = "text" | "voice";

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  /** Set on user messages: how the person gave us this. */
  inputType?: Channel;
  /** Set on assistant messages: how PRIYA delivered it. */
  outputType?: Channel;
  /** True when the user spoke over PRIYA before she finished. */
  interrupted: boolean;
  /** The phase this message was produced in, kept for later review. */
  safetyPhase: SafetyPhase;
  createdAt: string;
};

export type Conversation = {
  id: string;
  mode: PriyaMode;
  /** Set when archived: a short name, then a note PRIYA reads later. */
  title?: string;
  summary?: string;
  messages: Message[];
  /**
   * Survives turns, refreshes, and channel switches. The single source of
   * truth for safety — VoiceCall reads this rather than keeping its own.
   */
  safetyPhase: SafetyPhase;
  createdAt: string;
  updatedAt: string;
  /** Set when the conversation was closed off and archived. */
  endedAt?: string;
};

export const MEMORY_CATEGORIES = [
  "upcoming_event",
  "long_term_goal",
  "ongoing_challenge",
  "communication_preference",
  "important_relationship",
  "decision_to_revisit",
] as const;

export type MemoryCategory =
  | (typeof MEMORY_CATEGORIES)[number]
  | "general";

export type Memory = {
  id: string;
  summary: string;
  category: MemoryCategory;
  /** Nothing is ever stored without this being true. */
  approved: boolean;
  createdAt: string;
  updatedAt: string;
};

/** A proposal only. Nothing is stored until the user presses Remember this. */
export type SuggestedMemory = {
  text: string;
  category: MemoryCategory;
  reason: string;
};

export type Feedback = {
  id: string;
  conversationId: string;
  feltUnderstood: number;
  helpful: number;
  hasNextStep: boolean;
  comments?: string;
  createdAt: string;
};

export type Report = {
  id: string;
  conversationId: string;
  messageId: string;
  /** Copied, so a reported response survives the message changing. */
  content: string;
  reason: string;
  createdAt: string;
};

/**
 * An audit row for every non-normal classification. Nothing reads these yet;
 * they exist so the record is there when reviewing what PRIYA actually did.
 */
export type SafetyEvent = {
  id: string;
  conversationId: string;
  messageId?: string;
  state: SafetyState;
  phase: SafetyPhase;
  channel: Channel;
  createdAt: string;
};

export const REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

/**
 * Delivery preferences. These shape how PRIYA sounds and how much she says.
 * None of them touch the safety rules or the honesty rules.
 */
export type VoicePreference = {
  id: string;
  voice: RealtimeVoice;
  /** Playback rate handed to the realtime model, 0.7–1.2. */
  pace: number;
  warmth: "reserved" | "balanced" | "very_warm";
  directness: "gentle" | "balanced" | "direct";
  energy: "calm" | "balanced" | "upbeat";
  responseLength: "brief" | "balanced" | "thorough";
  /** How long the user can pause before PRIYA takes her turn. */
  silenceMs: number;
  useName: boolean;
  name?: string;
  updatedAt: string;
};

export const DEFAULT_VOICE_PREFERENCE: VoicePreference = {
  id: "default",
  voice: "marin",
  pace: 1,
  warmth: "balanced",
  directness: "balanced",
  energy: "calm",
  responseLength: "balanced",
  silenceMs: 700,
  useName: false,
  updatedAt: "1970-01-01T00:00:00.000Z",
};

/** Just the delivery knobs, without the storage bookkeeping. */
export type VoiceDelivery = Omit<VoicePreference, "id" | "updatedAt">;

/**
 * Reserved for the verified life-story data behind "Similar experiences".
 * Nothing produces these yet — until real data exists, that mode is required
 * to keep its examples plainly hypothetical.
 */
export type ExperienceMatch = {
  id: string;
  conversationId: string;
  /** Identifier of the verified experience this matched against. */
  experienceId: string;
  relevance: number;
  /** Why it was surfaced. Shown to the user rather than hidden. */
  rationale: string;
  createdAt: string;
};

/** A past conversation, condensed, as handed to PRIYA for continuity. */
export type RecalledConversation = {
  title: string;
  summary: string;
  when: string;
};

export type ChatRequest = {
  mode: PriyaMode;
  messages: Pick<Message, "role" | "content">[];
  memories?: string[];
  userId?: string;
  /** Where the conversation already was, so a disclosure carries forward. */
  safetyPhase?: SafetyPhase;
  /** Earlier conversations, so PRIYA can pick up threads across sessions. */
  recalled?: RecalledConversation[];
};

export type ChatResponse = {
  message: string;
  /** What the classifier said about this turn, for the audit record. */
  safetyState: SafetyState;
  safetyPhase: SafetyPhase;
  suggestMemory?: SuggestedMemory | null;
};

export type ModerationResponse = {
  safetyState: SafetyState;
  /** Present when safetyState is high_risk: what PRIYA should say and show. */
  crisisMessage?: string;
};

/** The shape of a full local export. */
export type PriyaExport = {
  exportedAt: string;
  version: 1;
  conversations: Conversation[];
  messages: Message[];
  memories: Memory[];
  feedback: Feedback[];
  reports: Report[];
  safetyEvents: SafetyEvent[];
  voicePreferences: VoicePreference[];
};
