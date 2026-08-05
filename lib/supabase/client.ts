import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * The browser client. Reaches Postgres directly with the publishable key, so
 * every table it touches must have Row Level Security enabled — RLS is the
 * only thing keeping one tester's conversations away from another's.
 *
 * One instance, shared, with cookie handling stated rather than left to the
 * default. Relying on the default meant the session was written on sign-in and
 * not read back afterwards: every query left carrying the publishable key as
 * its bearer token, arrived as the anonymous role, and was refused. The app
 * then concluded the person had no conversation and started a fresh one,
 * quietly fragmenting their history one sign-in at a time.
 */
export function createClient(): SupabaseClient {
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            if (typeof document === "undefined") {
              return [];
            }

            return document.cookie
              .split(";")
              .map((entry) => entry.trim())
              .filter(Boolean)
              .map((entry) => {
                const separator = entry.indexOf("=");

                return {
                  name: entry.slice(0, separator),
                  value: decodeURIComponent(entry.slice(separator + 1)),
                };
              });
          },
          setAll(cookies) {
            if (typeof document === "undefined") {
              return;
            }

            cookies.forEach(({ name, value, options }) => {
              const parts = [
                `${name}=${encodeURIComponent(value)}`,
                `path=${options?.path ?? "/"}`,
                `max-age=${options?.maxAge ?? 34560000}`,
                `SameSite=${options?.sameSite ?? "Lax"}`,
              ];

              document.cookie = parts.join("; ");
            });
          },
        },
      },
    );
  }

  return browserClient;
}

/** Whether Supabase is configured at all. Without it the app stays local. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
