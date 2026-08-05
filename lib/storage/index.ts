import type { SupabaseClient } from "@supabase/supabase-js";

import { LocalStorageAdapter } from "./local-storage-adapter";
import { SupabaseStorageAdapter } from "./supabase-adapter";
import type { PriyaStorage } from "./types";

export type { PriyaStorage } from "./types";
export { LocalStorageAdapter } from "./local-storage-adapter";
export { SupabaseStorageAdapter } from "./supabase-adapter";

/**
 * Which backing store the app uses.
 *
 * Supabase when it is configured, localStorage otherwise. Keeping the local
 * adapter is deliberate: it runs offline, needs no Docker, and is what the
 * storage tests exercise, so the contract stays covered without a database.
 */
const useSupabase = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

let adapter: PriyaStorage | null = null;

/**
 * Hands the storage layer the exact authenticated client to use.
 *
 * Constructing its own was the bug: the adapter's client had no session, so
 * every query left with the publishable key as its bearer token and arrived as
 * the anonymous role. The database refused it, the app concluded the person
 * had no conversation, and started a new one — quietly fragmenting their
 * history one sign-in at a time. Taking the client that already signed in
 * removes the possibility of the two disagreeing.
 */
export function useSupabaseClient(client: SupabaseClient): void {
  adapter = new SupabaseStorageAdapter(client);
}

/** Falls back to browser-local storage, e.g. after signing out. */
export function useLocalStorage(): void {
  adapter = new LocalStorageAdapter();
}

function resolveAdapter(): PriyaStorage {
  if (!adapter) {
    adapter =
      useSupabase && typeof window !== "undefined"
        ? new SupabaseStorageAdapter()
        : new LocalStorageAdapter();
  }

  return adapter;
}

/*
 * A thin pass-through rather than a bare instance: the Supabase client needs a
 * browser to exist before it is constructed, and the store imports this module
 * at load time on the server too.
 */
export const priyaStorage: PriyaStorage = {
  getActiveConversation: () => resolveAdapter().getActiveConversation(),
  setActiveConversation: (c) => resolveAdapter().setActiveConversation(c),
  getConversations: () => resolveAdapter().getConversations(),
  saveConversation: (c) => resolveAdapter().saveConversation(c),
  saveConversationMetadata: (c) => resolveAdapter().saveConversationMetadata(c),
  saveMessage: (m) => resolveAdapter().saveMessage(m),
  deleteConversation: (id) => resolveAdapter().deleteConversation(id),
  getMemories: () => resolveAdapter().getMemories(),
  saveMemory: (m) => resolveAdapter().saveMemory(m),
  updateMemory: (m) => resolveAdapter().updateMemory(m),
  deleteMemory: (id) => resolveAdapter().deleteMemory(id),
  getFeedback: () => resolveAdapter().getFeedback(),
  saveFeedback: (f) => resolveAdapter().saveFeedback(f),
  getReports: () => resolveAdapter().getReports(),
  saveReport: (r) => resolveAdapter().saveReport(r),
  getSafetyEvents: () => resolveAdapter().getSafetyEvents(),
  saveSafetyEvent: (e) => resolveAdapter().saveSafetyEvent(e),
  getVoicePreference: () => resolveAdapter().getVoicePreference(),
  saveVoicePreference: (p) => resolveAdapter().saveVoicePreference(p),
  exportAll: () => resolveAdapter().exportAll(),
  clearAll: () => resolveAdapter().clearAll(),
};

/** Tests swap in their own adapter; nothing in the app should call this. */
export function __setAdapterForTests(next: PriyaStorage | null): void {
  adapter = next;
}
