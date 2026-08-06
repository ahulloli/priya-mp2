import { useSyncExternalStore } from "react";

import { priyaStorage } from "@/lib/storage";
import type {
  Channel,
  Conversation,
  Feedback,
  Memory,
  MemoryCategory,
  Message,
  PriyaMode,
  RecalledConversation,
  Report,
  SafetyEvent,
  SafetyPhase,
  SafetyState,
  VoicePreference,
} from "@/types/chat";
import { DEFAULT_VOICE_PREFERENCE } from "@/types/chat";

/*
 * One store behind both channels. Typing and speaking append to the same
 * conversation, which is what lets someone start in text, move to voice, and
 * come back without losing the thread.
 *
 * Nothing here touches localStorage. Persistence goes through priyaStorage, so
 * pointing it at Supabase is a change in lib/storage rather than in here.
 */

/*
 * sessionStorage is the whole trick behind "closing the app ends the
 * conversation". It survives a refresh but is wiped when the tab closes, so
 * its absence means the app was genuinely reopened rather than reloaded.
 * Deliberately not in the storage interface: it is a browser-session signal,
 * not user data, and it has no meaning on a server.
 */
const SESSION_KEY = "priya.session";

/*
 * The greeting needs a stable *shape* but a unique id. It used to be the
 * literal string "priya-greeting" for every conversation, which is harmless
 * inside a per-conversation blob and a primary-key collision the moment
 * messages become rows.
 */
const GREETING_PREFIX = "greeting_";

export type StoreState = {
  conversation: Conversation | null;
  /**
   * Set when a write to storage failed. The UI surfaces this: silently
   * dropping a write while the conversation still looks saved on screen is
   * the worst outcome — the person believes it is stored and it is not.
   */
  writeError: string | null;
  /** Finished conversations, newest first. */
  archive: Conversation[];
  memories: Memory[];
  preference: VoicePreference;
  feedback: Feedback[];
  reports: Report[];
};

/* Server and first client render share this, so hydration matches. */
const EMPTY_STATE: StoreState = {
  conversation: null,
  writeError: null,
  archive: [],
  memories: [],
  preference: DEFAULT_VOICE_PREFERENCE,
  feedback: [],
  reports: [],
};

let state: StoreState = EMPTY_STATE;
let hydrated = false;
/* Whose data is currently in memory, so a different account cannot inherit it. */
let loadedFor: string | null = null;

const listeners = new Set<() => void>();

function emit(next: StoreState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function now(): string {
  return new Date().toISOString();
}

export function createConversation(mode: PriyaMode): Conversation {
  const timestamp = now();
  const id = `conv_${crypto.randomUUID()}`;

  return {
    id,
    mode,
    safetyPhase: "normal",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: `${GREETING_PREFIX}${id}`,
        conversationId: id,
        role: "assistant",
        content: "Hi, I’m PRIYA. What has been on your mind lately?",
        outputType: "text",
        interrupted: false,
        safetyPhase: "normal",
        createdAt: timestamp,
      },
    ],
  };
}

export function isGreeting(message: Message): boolean {
  /* The bare string is the pre-migration form; still recognised on read. */
  return (
    message.id.startsWith(GREETING_PREFIX) || message.id === "priya-greeting"
  );
}

/** A conversation nobody actually said anything in isn't worth keeping. */
function hasContent(conversation: Conversation): boolean {
  return conversation.messages.some((message) => message.role === "user");
}

/** Used immediately, then replaced by the model's title when it arrives. */
export function fallbackTitle(conversation: Conversation): string {
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
 * Asks the model to name the conversation and write the note PRIYA reads
 * before later ones. Failure is silent — the fallback title is already showing,
 * and a conversation with no summary simply contributes nothing to recall.
 */
async function upgradeTitle(conversation: Conversation): Promise<void> {
  try {
    const response = await fetch("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: conversation.messages
          .filter((message) => !isGreeting(message))
          .map(({ role, content }) => ({ role, content })),
      }),
    });

    if (!response.ok) {
      return;
    }

    const { title, summary } = (await response.json()) as {
      title: string | null;
      summary: string | null;
    };

    if (!title && !summary) {
      return;
    }

    const updated = {
      ...conversation,
      title: title ?? conversation.title,
      summary: summary ?? conversation.summary,
    };

    await priyaStorage.saveConversation(updated);

    emit({
      ...state,
      archive: state.archive.map((entry) =>
        entry.id === updated.id ? updated : entry,
      ),
    });
  } catch {
    /* Keep the fallback. */
  }
}

/**
 * Turns a Supabase error into something readable.
 *
 * PostgrestError and AuthError carry their detail on non-enumerable fields, so
 * passing one straight to console.error prints "{}" — which is how this went
 * unexplained for a while.
 */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    return (
      [e.message, e.code, e.details, e.hint].filter(Boolean).join(" | ") ||
      JSON.stringify(error)
    );
  }

  return String(error);
}

/**
 * Drops everything in memory. Called when the signed-in account changes: the
 * store is a module singleton, so without this the next person to sign in on
 * the same tab would be looking at the previous person's conversation.
 */
export function resetStore(): void {
  hydrated = false;
  loadedFor = null;
  emit(EMPTY_STATE);
}

async function hydrate(userId: string | null = loadedFor): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  if (hydrated && loadedFor === userId) {
    return;
  }

  hydrated = true;
  loadedFor = userId;

  let stored: Conversation | null = null;
  let archived: Conversation[] = [];
  let memories: Memory[] = [];
  let preference: VoicePreference = DEFAULT_VOICE_PREFERENCE;
  let feedback: Feedback[] = [];
  let reports: Report[] = [];

  try {
    /*
     * Read through the server when Supabase is in play. The browser client's
     * session is not reliably attached at this point — reads were arriving as
     * the anonymous role — whereas the server client takes its session from
     * the request cookies and cannot race.
     */
    const bootstrapped = await bootstrapFromServer();

    if (bootstrapped) {
      ({ stored, archived, memories, preference, feedback, reports } =
        bootstrapped);
    } else {
      [stored, archived, memories, preference, feedback, reports] =
        await Promise.all([
          priyaStorage.getActiveConversation(),
          priyaStorage.getConversations(),
          priyaStorage.getMemories(),
          priyaStorage.getVoicePreference(),
          priyaStorage.getFeedback(),
          priyaStorage.getReports(),
        ]);
    }
  } catch (error) {
    /*
     * A failed read must not leave conversation null, which renders as a
     * permanent "Loading…". Start an empty conversation instead: the person
     * can still talk, and nothing already stored has been touched.
     */
    /*
     * A failed read is a failed read. It is not "this person has no
     * conversations", and treating it that way archived the conversation they
     * were in and started an empty one — every sign-in, silently.
     */
    console.error("PRIYA could not load stored data:", describe(error));

    /*
     * Allow another attempt. Leaving this marked as loaded would strand the
     * app in an empty state until a full page reload, even once the database
     * came back.
     */
    hydrated = false;

    emit({
      ...state,
      writeError:
        "PRIYA couldn’t load your earlier conversations. They aren’t lost — but nothing said now will be saved until this reconnects.",
    });

    return;
  }

  /* No marker means the app was reopened, not refreshed. */
  const isNewAppSession =
    window.sessionStorage.getItem(SESSION_KEY) === null;

  window.sessionStorage.setItem(SESSION_KEY, "1");

  let conversation: Conversation;
  let archive = archived;
  let toTitle: Conversation | null = null;

  if (stored && isNewAppSession && hasContent(stored)) {
    /* Close the book on it and start fresh. */
    const finished: Conversation = {
      ...stored,
      title: stored.title ?? fallbackTitle(stored),
      endedAt: now(),
    };

    await priyaStorage.saveConversation(finished);
    archive = [finished, ...archive];

    conversation = createConversation(stored.mode);
    await priyaStorage.setActiveConversation(conversation);
    toTitle = finished;
  } else if (stored) {
    conversation = stored;
  } else {
    /*
     * First run, or storage came back empty. Persist immediately: granular
     * message writes attach to an existing conversation, so one that only
     * exists in memory would silently swallow every turn.
     */
    conversation = createConversation("listen");
    await priyaStorage.setActiveConversation(conversation);
  }

  emit({
    ...state,
    conversation,
    archive,
    memories,
    preference,
    feedback,
    reports,
  });

  if (toTitle) {
    /* Fire and forget; the list already shows the fallback. */
    void upgradeTitle(toTitle);
  }
}

function subscribe(listener: () => void): () => void {
  /* First subscriber pulls state out of storage. */
  void hydrate();
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

/*
 * Conversation writes are chained rather than fired off independently.
 *
 * Against localStorage the difference is invisible, because writes complete
 * synchronously. Against a database they are network requests, and two in
 * flight can land out of order — an older transcript arriving after a newer
 * one and overwriting it. Serialising them costs nothing here and prevents
 * silent data loss once the adapter talks to Supabase.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/** Reports failure loudly; a write that vanished quietly is the bad outcome. */
function enqueueWrite(write: () => Promise<unknown>, label: string): void {
  writeQueue = writeQueue
    .then(write)
    .then(() => {
      if (state.writeError) {
        /* A later write got through, so the connection is back. */
        emit({ ...state, writeError: null });
      }
    })
    .catch((error) => {
      console.error(`PRIYA ${label} failed:`, describe(error));
      emit({
        ...state,
        writeError:
          "PRIYA couldn’t save that. What’s on screen may not be stored — check your connection and try again.",
      });
    });
}

type Bootstrapped = {
  stored: Conversation | null;
  archived: Conversation[];
  memories: Memory[];
  preference: VoicePreference;
  feedback: Feedback[];
  reports: Report[];
};

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    role: row.role as Message["role"],
    content: row.content as string,
    inputType: (row.input_type as Message["inputType"]) ?? undefined,
    outputType: (row.output_type as Message["outputType"]) ?? undefined,
    interrupted: Boolean(row.interrupted),
    safetyPhase: row.safety_phase as Message["safetyPhase"],
    createdAt: row.created_at as string,
  };
}

function rowToConversation(
  row: Record<string, unknown>,
  messages: Message[],
): Conversation {
  return {
    id: row.id as string,
    mode: row.mode as Conversation["mode"],
    title: (row.title as string) ?? undefined,
    summary: (row.summary as string) ?? undefined,
    messages,
    safetyPhase: row.safety_phase as Conversation["safetyPhase"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    endedAt: (row.ended_at as string) ?? undefined,
  };
}

/**
 * Startup read, performed by the server under the user's own JWT.
 *
 * Returns null when Supabase is not configured, so the local adapter is used
 * instead. Throws on a real failure — the caller must not mistake that for an
 * empty account.
 */
async function bootstrapFromServer(): Promise<Bootstrapped | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return null;
  }

  const response = await fetch("/api/bootstrap", {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 401) {
    /* Signed out. Not an error, and not data either. */
    return {
      stored: null,
      archived: [],
      memories: [],
      preference: DEFAULT_VOICE_PREFERENCE,
      feedback: [],
      reports: [],
    };
  }

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? `Bootstrap failed (${response.status})`);
  }

  const messages = (body.activeMessages as Record<string, unknown>[]).map(
    rowToMessage,
  );

  return {
    stored: body.activeConversation
      ? rowToConversation(body.activeConversation, messages)
      : null,
    archived: (body.archivedConversations as Record<string, unknown>[]).map(
      (row) => rowToConversation(row, []),
    ),
    memories: (body.memories as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      summary: row.summary as string,
      category: row.category as Memory["category"],
      approved: Boolean(row.approved),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    })),
    preference: body.voicePreference
      ? {
          id: body.voicePreference.user_id,
          voice: body.voicePreference.voice,
          pace: Number(body.voicePreference.pace),
          warmth: body.voicePreference.warmth,
          directness: body.voicePreference.directness,
          energy: body.voicePreference.energy,
          responseLength: body.voicePreference.response_length,
          silenceMs: body.voicePreference.silence_ms,
          useName: Boolean(body.voicePreference.use_name),
          name: body.voicePreference.name ?? undefined,
          updatedAt: body.voicePreference.updated_at,
        }
      : DEFAULT_VOICE_PREFERENCE,
    feedback: (body.feedback as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      feltUnderstood: row.felt_understood as number,
      helpful: row.helpful as number,
      hasNextStep: Boolean(row.has_next_step),
      comments: (row.comments as string) ?? undefined,
      createdAt: row.created_at as string,
    })),
    reports: (body.reports as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      messageId: row.message_id as string,
      content: row.content as string,
      reason: row.reason as string,
      createdAt: row.created_at as string,
    })),
  };
}

/** Loads a specific account's data, replacing whatever is in memory. */
export function hydrateFor(userId: string | null): void {
  if (loadedFor !== userId) {
    resetStore();
  }

  void hydrate(userId);
}

/** Reads the store synchronously. Tests use this; the UI uses the hook. */
export function readState(): StoreState {
  return state;
}

export function clearWriteError(): void {
  emit({ ...state, writeError: null });
}

/** Waits for pending writes. Tests use this; the UI never needs to. */
export function flushWrites(): Promise<unknown> {
  return writeQueue;
}

/**
 * Metadata only — mode, title, summary, safety phase. The transcript is
 * persisted per message instead, so a metadata write can never clobber a
 * message that landed after it was queued.
 */
function persistConversation(conversation: Conversation): void {
  const stamped = { ...conversation, updatedAt: now() };

  /*
   * Any message this update introduced has to be written too.
   *
   * Splitting persistence into metadata and per-message writes left a trap:
   * a caller that added a message through updateConversation got the row
   * updated and the message silently dropped. That is exactly what happened
   * to every user message — the transcript on screen looked complete while
   * the database held only PRIYA's replies. Diffing here closes the whole
   * class rather than the one call site that hit it.
   */
  const known = new Set(
    (state.conversation?.messages ?? []).map((message) => message.id),
  );
  const added = stamped.messages.filter((message) => !known.has(message.id));

  emit({ ...state, conversation: stamped });

  enqueueWrite(
    () => priyaStorage.saveConversationMetadata(stamped),
    "conversation metadata write",
  );

  added.forEach((message) =>
    enqueueWrite(() => priyaStorage.saveMessage(message), "message write"),
  );
}

export function updateConversation(
  update: (conversation: Conversation) => Conversation,
): void {
  if (state.conversation) {
    persistConversation(update(state.conversation));
  }
}

/** Builds a message already carrying its conversation and phase. */
export function createMessage(
  role: Message["role"],
  content: string,
  options: {
    inputType?: Channel;
    outputType?: Channel;
    interrupted?: boolean;
  } = {},
): Message {
  const conversation = state.conversation;

  return {
    id: crypto.randomUUID(),
    conversationId: conversation?.id ?? "unknown",
    role,
    content,
    inputType: options.inputType,
    outputType: options.outputType,
    interrupted: options.interrupted ?? false,
    safetyPhase: conversation?.safetyPhase ?? "normal",
    createdAt: now(),
  };
}

export function appendMessage(message: Message): void {
  if (!state.conversation) {
    return;
  }

  const stamped = {
    ...state.conversation,
    messages: [...state.conversation.messages, message],
    updatedAt: now(),
  };

  emit({ ...state, conversation: stamped });

  /* One row, keyed on the message's own id — nothing else is rewritten. */
  enqueueWrite(() => priyaStorage.saveMessage(message), "message write");
}

export function setMode(mode: PriyaMode): void {
  updateConversation((conversation) => ({ ...conversation, mode }));
}

/** Files the current conversation away, if there's anything in it. */
async function archiveCurrent(): Promise<Conversation[]> {
  const current = state.conversation;

  if (!current || !hasContent(current)) {
    return state.archive;
  }

  const finished: Conversation = {
    ...current,
    title: current.title ?? fallbackTitle(current),
    endedAt: now(),
  };

  await priyaStorage.saveConversation(finished);

  if (!current.title) {
    void upgradeTitle(finished);
  }

  return [finished, ...state.archive];
}

/** "Start a new conversation" — the old one is kept and titled, not discarded. */
export async function resetConversation(mode: PriyaMode): Promise<void> {
  const archive = await archiveCurrent();
  const conversation = createConversation(mode);

  await priyaStorage.setActiveConversation(conversation);
  emit({ ...state, conversation, archive });
}

/**
 * Reopens a past conversation. It comes out of the archive and becomes current
 * so it can be continued; it gets filed again when this session ends.
 */
export async function openConversation(id: string): Promise<void> {
  const target = state.archive.find((entry) => entry.id === id);

  if (!target) {
    return;
  }

  const archive = (await archiveCurrent()).filter(
    (entry) => entry.id !== id,
  );

  await priyaStorage.deleteConversation(id);
  await priyaStorage.setActiveConversation(target);

  emit({ ...state, conversation: target, archive });
}

export async function deleteArchivedConversation(id: string): Promise<void> {
  await priyaStorage.deleteConversation(id);

  emit({
    ...state,
    archive: state.archive.filter((entry) => entry.id !== id),
  });
}

/**
 * The only way a memory is created. Callers pass text the user has seen and
 * explicitly approved — nothing is inferred and stored on its own.
 */
export async function approveMemory(
  summary: string,
  category: MemoryCategory = "general",
): Promise<void> {
  const trimmed = summary.trim();

  if (!trimmed) {
    return;
  }

  const timestamp = now();
  const memory: Memory = {
    id: crypto.randomUUID(),
    summary: trimmed,
    category,
    approved: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await priyaStorage.saveMemory(memory);
  emit({ ...state, memories: [...state.memories, memory] });
}

/** Approved memories stay editable; a saved detail can go stale or be wrong. */
export async function editMemory(
  id: string,
  summary: string,
): Promise<void> {
  const trimmed = summary.trim();
  const existing = state.memories.find((memory) => memory.id === id);

  if (!trimmed || !existing) {
    return;
  }

  const updated: Memory = {
    ...existing,
    summary: trimmed,
    updatedAt: now(),
  };

  await priyaStorage.updateMemory(updated);

  emit({
    ...state,
    memories: state.memories.map((memory) =>
      memory.id === id ? updated : memory,
    ),
  });
}

export async function deleteMemory(id: string): Promise<void> {
  await priyaStorage.deleteMemory(id);

  emit({
    ...state,
    memories: state.memories.filter((memory) => memory.id !== id),
  });
}

export async function saveVoicePreference(
  preference: VoicePreference,
): Promise<void> {
  const stamped = { ...preference, updatedAt: now() };

  await priyaStorage.saveVoicePreference(stamped);
  emit({ ...state, preference: stamped });
}

/**
 * The single source of truth for safety, shared by text and voice. Persisted
 * so a disclosure survives the next turn, a refresh, and a channel switch.
 */
export function setSafetyPhase(safetyPhase: SafetyPhase): void {
  updateConversation((conversation) => ({ ...conversation, safetyPhase }));
}

/**
 * An audit row, written whenever the classifier says anything but normal.
 *
 * Retries rather than writing once, and reports failure loudly instead of
 * swallowing it. localStorage effectively cannot fail; a network-backed
 * adapter can, and a safety record that silently vanished would be worse than
 * one that never existed — the export would look clean.
 *
 * With Supabase this should become a durable queue that survives a reload,
 * not just an in-memory retry.
 */
export async function recordSafetyEvent(
  stateValue: SafetyState,
  phase: SafetyPhase,
  channel: Channel,
  messageId?: string,
): Promise<boolean> {
  if (stateValue === "normal" && phase === "normal") {
    return true;
  }

  const event: SafetyEvent = {
    id: crypto.randomUUID(),
    conversationId: state.conversation?.id ?? "unknown",
    messageId,
    state: stateValue,
    phase,
    channel,
    createdAt: now(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await priyaStorage.saveSafetyEvent(event);
      return true;
    } catch (error) {
      if (attempt === 2) {
        console.error("PRIYA failed to record a safety event:", error, event);
        return false;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 200 * (attempt + 1)),
      );
    }
  }

  return false;
}

export async function saveFeedback(
  entry: Omit<Feedback, "id" | "conversationId" | "createdAt">,
): Promise<void> {
  if (!state.conversation) {
    return;
  }

  const feedback: Feedback = {
    ...entry,
    id: crypto.randomUUID(),
    conversationId: state.conversation.id,
    createdAt: now(),
  };

  await priyaStorage.saveFeedback(feedback);
  emit({ ...state, feedback: [...state.feedback, feedback] });
}

export async function saveReport(
  messageId: string,
  content: string,
  reason: string,
): Promise<void> {
  if (!state.conversation) {
    return;
  }

  const report: Report = {
    id: crypto.randomUUID(),
    conversationId: state.conversation.id,
    messageId,
    content,
    reason,
    createdAt: now(),
  };

  await priyaStorage.saveReport(report);
  emit({ ...state, reports: [...state.reports, report] });
}

/** Only approved memories are ever sent to the model. */
export function approvedMemoryText(memories: Memory[]): string[] {
  return memories
    .filter((memory) => memory.approved)
    .map((memory) => memory.summary);
}

export function whenLabel(iso: string, reference = Date.now()): string {
  const date = new Date(iso);
  const days = Math.floor((reference - date.getTime()) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;

  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/**
 * What PRIYA gets to know about earlier conversations. Only summarised ones
 * count — a conversation whose summary never came back contributes nothing
 * rather than dumping a raw transcript into the prompt.
 *
 * Newest first, capped: this rides along on every turn, so it has to stay
 * small. Once someone has hundreds, picking the relevant ones by similarity
 * beats taking the most recent.
 */
export function recalledConversations(
  archive: Conversation[],
  limit = 12,
): RecalledConversation[] {
  return archive
    .filter((entry) => entry.summary && entry.title)
    .slice(0, limit)
    .map((entry) => ({
      title: entry.title!,
      summary: entry.summary!,
      when: whenLabel(entry.updatedAt),
    }));
}

/** Development tools. */
export async function exportAll() {
  return priyaStorage.exportAll();
}

export async function clearAll(): Promise<void> {
  await priyaStorage.clearAll();

  hydrated = false;
  emit(EMPTY_STATE);
  void hydrate();
}
