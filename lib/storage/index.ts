import { LocalStorageAdapter } from "./local-storage-adapter";
import type { PriyaStorage } from "./types";

export type { PriyaStorage } from "./types";
export { LocalStorageAdapter } from "./local-storage-adapter";

/**
 * The one place the backing store is chosen. Connecting Supabase should be a
 * one-line change here:
 *
 *   export const priyaStorage = new SupabaseStorageAdapter();
 */
export const priyaStorage: PriyaStorage = new LocalStorageAdapter();
