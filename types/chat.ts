export type PriyaMode =
  | "listen"
  | "understand"
  | "similar"
  | "plan";

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

/** Phases where PRIYA is still holding a disclosure. */
export function isActiveSafetyPhase(phase: SafetyPhase): boolean {
  return (
    phase === "immediate_safety_check" || phase === "safety_follow_up"
  );
}

/** Voice is just another format. The conversation stays text internally. */
export type Channel = "text" | "voice";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Set on user messages: how the person gave us this. */
  input_type?: Channel;
  /** Set on assistant messages: how PRIYA delivered it. */
  output_type?: Channel;
  /** True when the user spoke over PRIYA before she finished. */
  interrupted?: boolean;
  /** The phase this message was produced in, kept for later review. */
  safetyPhase?: SafetyPhase;
  createdAt?: string;
};

export type Conversation = {
  conversation_id: string;
  mode: PriyaMode;
  messages: ChatMessage[];
  /**
   * Survives turns, refreshes, and channel switches. The single source of
   * truth for safety — VoiceCall reads this rather than keeping its own.
   */
  safetyPhase: SafetyPhase;
  createdAt: string;
  updatedAt: string;
};

export type Memory = {
  id: string;
  summary: string;
  category: string;
  /** Nothing is ever stored without this being true. */
  approved: boolean;
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
export type VoicePreferences = {
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
};

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  voice: "marin",
  pace: 1,
  warmth: "balanced",
  directness: "balanced",
  energy: "calm",
  responseLength: "balanced",
  silenceMs: 700,
  useName: false,
};

export const MEMORY_CATEGORIES = [
  "upcoming_event",
  "long_term_goal",
  "ongoing_challenge",
  "communication_preference",
  "important_relationship",
  "decision_to_revisit",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/** A proposal only. Nothing is stored until the user presses Remember this. */
export type SuggestedMemory = {
  text: string;
  category: MemoryCategory;
  reason: string;
};

export type ChatRequest = {
  mode: PriyaMode;
  messages: Pick<ChatMessage, "role" | "content">[];
  memories?: string[];
  userId?: string;
  /** Where the conversation already was, so a disclosure carries forward. */
  safetyPhase?: SafetyPhase;
};

export type ChatResponse = {
  message: string;
  safetyPhase: SafetyPhase;
  suggestMemory?: SuggestedMemory | null;
};

export type Feedback = {
  id: string;
  conversation_id: string;
  feltUnderstood: number;
  helpful: number;
  hasNextStep: boolean;
  comments?: string;
  createdAt: string;
};

export type ReportedResponse = {
  id: string;
  conversation_id: string;
  messageId: string;
  content: string;
  reason: string;
  createdAt: string;
};

export type ModerationResponse = {
  safetyState: SafetyState;
  /** Present when safetyState is high_risk: what PRIYA should say and show. */
  crisisMessage?: string;
};
