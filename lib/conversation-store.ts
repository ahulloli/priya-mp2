import { useSyncExternalStore } from "react";

import type {
  ChatMessage,
  Conversation,
  Memory,
  PriyaMode,
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
};

/* Server and first client render share this, so hydration matches. */
const EMPTY_STATE: StoreState = {
  conversation: null,
  memories: [],
  preferences: DEFAULT_VOICE_PREFERENCES,
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
        ? stored
        : createConversation("listen"),
    memories: read<Memory[]>(MEMORIES_KEY, []),
    preferences: {
      ...DEFAULT_VOICE_PREFERENCES,
      ...read<Partial<VoicePreferences>>(PREFERENCES_KEY, {}),
    },
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

export function deleteMemory(id: string): void {
  const memories = state.memories.filter((memory) => memory.id !== id);

  write(MEMORIES_KEY, memories);
  emit({ ...state, memories });
}

export function saveVoicePreferences(preferences: VoicePreferences): void {
  write(PREFERENCES_KEY, preferences);
  emit({ ...state, preferences });
}

/** Only approved memories are ever sent to the model. */
export function approvedMemoryText(memories: Memory[]): string[] {
  return memories
    .filter((memory) => memory.approved)
    .map((memory) => memory.summary);
}
