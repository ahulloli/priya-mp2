import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

/**
 * The server client, reading the session from cookies.
 *
 * This is how API routes learn who is calling. Identity must never come from
 * the request body — a browser can put any user id it likes in JSON, and the
 * whole point of moving off "local-test-user" is that the server stops taking
 * the client's word for it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            /* Called from a Server Component; middleware refreshes instead. */
          }
        },
      },
    },
  );
}

/**
 * The authenticated user, or null.
 *
 * Uses getUser() rather than getSession(): getSession reads the cookie without
 * verifying it, which is fine for rendering and useless for authorisation.
 */
export async function getUser() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return null;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
