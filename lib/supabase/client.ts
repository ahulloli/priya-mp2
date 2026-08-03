import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser client. Reaches Postgres directly with the publishable key, so
 * every table it touches must have Row Level Security enabled — RLS is the
 * only thing keeping one tester's conversations away from another's.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

/** Whether Supabase is configured at all. Without it the app stays local. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
