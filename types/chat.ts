export type PriyaMode =
  | "listen"
  | "understand"
  | "similar"
  | "plan";

export type SafetyState = "normal" | "supportive" | "high_risk";

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
  safetyState?: SafetyState;
  createdAt?: string;
};

export type Conversation = {
  conversation_id: string;
  mode: PriyaMode;
  messages: ChatMessage[];
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

export type ChatRequest = {
  mode: PriyaMode;
  messages: Pick<ChatMessage, "role" | "content">[];
  memories?: string[];
  userId?: string;
};

export type ChatResponse = {
  message: string;
  safetyState: SafetyState;
  suggestMemory?: string | null;
};

export type ModerationResponse = {
  safetyState: SafetyState;
  /** Present when safetyState is high_risk: what PRIYA should say and show. */
  crisisMessage?: string;
};
