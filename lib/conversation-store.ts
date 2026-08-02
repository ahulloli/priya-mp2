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
const ARCHIVE_KEY = "priya.conversations";
const MEMORIES_KEY = "priya.memories";
const PREFERENCES_KEY = "priya.voicePreferences";
const FEEDBACK_KEY = "priya.feedback";
const REPORTS_KEY = "priya.reports";

/*
 * sessionStorage is the whole trick behind "closing the app ends the
 * conversation". It survives a refresh but is wiped when the tab closes, so
 * its absence means the app was genuinely reopened rather than reloaded.
 */
const SESSION_KEY = "priya.session";

const GREETING: ChatMessage = {
  id: "priya-greeting",
  role: "assistant",
  content: "Hi, I’m PRIYA. What has been on your mind lately?",
  output_type: "text",
};

export type StoreState = {
  conversation: Conversation | null;
  /** Finished conversations, newest first. */
  archive: Conversation[];
  memories: Memory[];
  preferences: VoicePreferences;
  feedback: Feedback[];
  reports: ReportedResponse[];
};

/* Server and first client render share this, so hydration matches. */
const EMPTY_STATE: StoreState = {
  conversation: null,
  archive: [],
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

/** A conversation nobody actually said anything in isn't worth keeping. */
function hasContent(conversation: Conversation): boolean {
  return conversation.messages.some((message) => message.role === "user");
}

/** Used immediately, then replaced by the model's title when it arrives. */
function fallbackTitle(conversation: Conversation): string {
  const firstUser = conversation.messages.find(
    (message) => message.role === "user",
  );

  if (!firstUser) {
    return "Empty conversation";
  }

  const text = firstUser.content.trim();

  return text.length > 48 ? `${text.slice(0, 48).trim()}…` : text;
}

/**
 * Asks the model for a better name and swaps it in when it lands. Failure is
 * silent — the fallback title is already showing and is perfectly usable.
 */
async function upgradeTitle(conversation: Conversation): Promise<void> {
  try {
    const response = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages
          .filter((message) => message.id !== "priya-greeting")
          .map(({ role, content }) => ({ role, content })),
      }),
    });

    if (!response.ok) {
      return;
    }

    const { title } = (await response.json()) as { title: string | null };

    if (!title) {
      return;
    }

    const archive = state.archive.map((entry) =>
      entry.conversation_id === conversation.conversation_id
        ? { ...entry, title }
        : entry,
    );

    write(ARCHIVE_KEY, archive);
    emit({ ...state, archive });
  } catch {
    /* Keep the fallback. */
  }
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") {
    return;
  }

  hydrated = true;

  const stored = read<Conversation | null>(CONVERSATION_KEY, null);
  let archive = read<Conversation[]>(ARCHIVE_KEY, []);

  const previous =
    stored && Array.isArray(stored.messages)
      ? /* Records written before this field existed default to normal. */
        { ...stored, safetyPhase: stored.safetyPhase ?? "normal" }
      : null;

  /* No marker means the app was reopened, not refreshed. */
  const isNewAppSession =
    window.sessionStorage.getItem(SESSION_KEY) === null;

  window.sessionStorage.setItem(SESSION_KEY, "1");

  let current: Conversation;
  let toTitle: Conversation | null = null;

  if (previous && isNewAppSession && hasContent(previous)) {
    /* Close the book on it and start fresh. */
    const finished = { ...previous, title: fallbackTitle(previous) };

    archive = [finished, ...archive].slice(0, 100);
    write(ARCHIVE_KEY, archive);

    current = createConversation(previous.mode);
    write(CONVERSATION_KEY, current);
    toTitle = finished;
  } else {
    current = previous ?? createConversation("listen");
  }

  emit({
    conversation: current,
    archive,
    memories: read<Memory[]>(MEMORIES_KEY, []),
    preferences: {
      ...DEFAULT_VOICE_PREFERENCES,
      ...read<Partial<VoicePreferences>>(PREFERENCES_KEY, {}),
    },
    feedback: read<Feedback[]>(FEEDBACK_KEY, []),
    reports: read<ReportedResponse[]>(REPORTS_KEY, []),
  });

  if (toTitle) {
    /* Fire and forget; the list already shows the fallback. */
    void upgradeTitle(toTitle);
  }
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

/** Files the current conversation away, if there's anything in it. */
function archiveCurrent(): Conversation[] {
  const current = state.conversation;

  if (!current || !hasContent(current)) {
    return state.archive;
  }

  const finished = { ...current, title: current.title ?? fallbackTitle(current) };
  const archive = [finished, ...state.archive].slice(0, 100);

  write(ARCHIVE_KEY, archive);

  if (!current.title) {
    void upgradeTitle(finished);
  }

  return archive;
}

/** "Start a new conversation" — the old one is kept and titled, not discarded. */
export function resetConversation(mode: PriyaMode): void {
  const archive = archiveCurrent();
  const conversation = createConversation(mode);

  write(CONVERSATION_KEY, conversation);
  emit({ ...state, conversation, archive });
}

/**
 * Reopens a past conversation. It comes out of the archive and becomes current
 * so it can be continued; it gets filed again when this session ends.
 */
export function openConversation(id: string): void {
  const target = state.archive.find(
    (entry) => entry.conversation_id === id,
  );

  if (!target) {
    return;
  }

  const archive = archiveCurrent().filter(
    (entry) => entry.conversation_id !== id,
  );

  write(ARCHIVE_KEY, archive);
  write(CONVERSATION_KEY, target);
  emit({ ...state, conversation: target, archive });
}

export function deleteArchivedConversation(id: string): void {
  const archive = state.archive.filter(
    (entry) => entry.conversation_id !== id,
  );

  write(ARCHIVE_KEY, archive);
  emit({ ...state, archive });
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
