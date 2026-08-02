import { useSyncExternalStore } from "react";

import type {
  ChatMessage,
  Conversation,
  Feedback,
  Memory,
  PriyaMode,
  ReportedResponse,
  SafetyPhase,
  VoicePreferences,
} from "@/types/chat";
import { DEFAULT_VOICE_PREFERENCES } from "@/types/chat";

/*
 * One store behind both channels. Typing and speaking append to the same
 * conversation record, which is what lets someone start in text, move to
 * voice, and come back without losing the thread.
 *
 * Backed by localStorage for the prototype. The shapes match the Supabase
 * tables from the Phase 1 plan, so that swap should stay inside this file.
 */

const CONVERSATION_KEY = "priya.conversation";
const MEMORIES_KEY = "priya.memories";
const PREFERENCES_KEY = "priya.voicePreferences";
const FEEDBACK_KEY = "priya.feedback";
const REPORTS_KEY = "priya.reports";

const GREETING: ChatMessage = {
  id: "priya-greeting",
  role: "assistant",
  content: "Hi, I’m PRIYA. What has been on your mind lately?",
  output_type: "text",
};

export type StoreState = {
  conversation: Conversation | null;
  memories: Memory[];
  preferences: VoicePreferences;
  feedback: Feedback[];
  reports: ReportedResponse[];
};

/* Server and first client render share this, so hydration matches. */
const EMPTY_STATE: StoreState = {
  conversation: null,
  memories: [],
  preferences: DEFAULT_VOICE_PREFERENCES,
  feedback: [],
  reports: [],
};

let state: StoreState = EMPTY_STATE;
let hydrated = false;

const listeners = new Set<() => void>();

function emit(next: StoreState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    /* Corrupt or unavailable storage shouldn't take the app down. */
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota or private-mode failures are non-fatal; state stays in memory. */
  }
}

export function createConversation(mode: PriyaMode): Conversation {
  const now = new Date().toISOString();

  return {
    conversation_id: `conv_${crypto.randomUUID()}`,
    mode,
    messages: [{ ...GREETING, createdAt: now }],
    safetyPhase: "normal",
    createdAt: now,
    updatedAt: now,
  };
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") {
    return;
  }

  hydrated = true;

  const stored = read<Conversation | null>(CONVERSATION_KEY, null);

  emit({
    conversation:
      stored && Array.isArray(stored.messages)
        ? /* Records written before this field existed default to normal. */
          { ...stored, safetyPhase: stored.safetyPhase ?? "normal" }
        : createConversation("listen"),
    memories: read<Memory[]>(MEMORIES_KEY, []),
    preferences: {
      ...DEFAULT_VOICE_PREFERENCES,
      ...read<Partial<VoicePreferences>>(PREFERENCES_KEY, {}),
    },
    feedback: read<Feedback[]>(FEEDBACK_KEY, []),
    reports: read<ReportedResponse[]>(REPORTS_KEY, []),
  });
}

function subscribe(listener: () => void): () => void {
  /* First subscriber pulls state out of localStorage. */
  hydrate();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function usePriyaStore(): StoreState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY_STATE,
  );
}

function persistConversation(conversation: Conversation): void {
  const stamped = { ...conversation, updatedAt: new Date().toISOString() };
  write(CONVERSATION_KEY, stamped);
  emit({ ...state, conversation: stamped });
}

export function updateConversation(
  update: (conversation: Conversation) => Conversation,
): void {
  if (state.conversation) {
    persistConversation(update(state.conversation));
  }
}

export function appendMessage(message: ChatMessage): void {
  updateConversation((conversation) => ({
    ...conversation,
    messages: [...conversation.messages, message],
  }));
}

export function setMode(mode: PriyaMode): void {
  updateConversation((conversation) => ({ ...conversation, mode }));
}

export function resetConversation(mode: PriyaMode): void {
  persistConversation(createConversation(mode));
}

/**
 * The only way a memory is created. Callers pass text the user has seen and
 * explicitly approved — nothing is inferred and stored on its own.
 */
export function approveMemory(summary: string, category = "general"): void {
  const trimmed = summary.trim();

  if (!trimmed) {
    return;
  }

  const memories = [
    ...state.memories,
    {
      id: crypto.randomUUID(),
      summary: trimmed,
      category,
      approved: true,
      createdAt: new Date().toISOString(),
    },
  ];

  write(MEMORIES_KEY, memories);
  emit({ ...state, memories });
}

/** Approved memories stay editable; a saved detail can go stale or be wrong. */
export function editMemory(id: string, summary: string): void {
  const trimmed = summary.trim();

  if (!trimmed) {
    return;
  }

  const memories = state.memories.map((memory) =>
    memory.id === id ? { ...memory, summary: trimmed } : memory,
  );

  write(MEMORIES_KEY, memories);
  emit({ ...state, memories });
}

export function deleteMemory(id: string): void {
  const memories = state.memories.filter((memory) => memory.id !== id);

  write(MEMORIES_KEY, memories);
  emit({ ...state, memories });
}

export function saveVoicePreferences(preferences: VoicePreferences): void {
  write(PREFERENCES_KEY, preferences);
  emit({ ...state, preferences });
}

/**
 * The single source of truth for safety, shared by text and voice. Persisted
 * so a disclosure survives the next turn, a refresh, and a channel switch.
 */
export function setSafetyPhase(safetyPhase: SafetyPhase): void {
  updateConversation((conversation) => ({ ...conversation, safetyPhase }));
}

export function saveFeedback(
  entry: Omit<Feedback, "id" | "conversation_id" | "createdAt">,
): void {
  if (!state.conversation) {
    return;
  }

  const feedback = [
    ...state.feedback,
    {
      ...entry,
      id: crypto.randomUUID(),
      conversation_id: state.conversation.conversation_id,
      createdAt: new Date().toISOString(),
    },
  ];

  write(FEEDBACK_KEY, feedback);
  emit({ ...state, feedback });
}

export function saveReport(messageId: string, content: string, reason: string): void {
  if (!state.conversation) {
    return;
  }

  const reports = [
    ...state.reports,
    {
      id: crypto.randomUUID(),
      conversation_id: state.conversation.conversation_id,
      messageId,
      content,
      reason,
      createdAt: new Date().toISOString(),
    },
  ];

  write(REPORTS_KEY, reports);
  emit({ ...state, reports });
}

/** Only approved memories are ever sent to the model. */
export function approvedMemoryText(memories: Memory[]): string[] {
  return memories
    .filter((memory) => memory.approved)
    .map((memory) => memory.summary);
}
