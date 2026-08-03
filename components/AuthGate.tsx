"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Status = "checking" | "signedIn" | "signedOut";

/**
 * Holds the app back until a session exists.
 *
 * Not a security boundary — Row Level Security is. This only stops the store
 * hydrating against a database that would reject every read, which would
 * otherwise look like an app that silently lost your data.
 *
 * With Supabase unconfigured it gets out of the way entirely, so the app still
 * runs on localStorage.
 */
export default function AuthGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  /* The login page has to render for signed-out people, or nobody gets in. */
  const isAuthRoute = pathname?.startsWith("/login") ?? false;
  const [status, setStatus] = useState<Status>(
    isSupabaseConfigured() ? "checking" : "signedIn",
  );
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setStatus(data.user ? "signedIn" : "signedOut");
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setEmail(session?.user.email ?? null);
        setStatus(session ? "signedIn" : "signedOut");
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (status === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 text-stone-500">
        Loading…
      </main>
    );
  }

  if (status === "signedOut") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-stone-900">
        <div className="w-full max-w-sm space-y-4 rounded-3xl border border-stone-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold">PRIYA</h1>
          <p className="text-sm text-stone-600">
            Sign in so your conversations are here next time.
          </p>
          <button
            type="button"
            onClick={() => router.push("/login")}
            className="w-full rounded-xl bg-stone-900 px-4 py-2.5 font-medium text-white"
          >
            Sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      {email && (
        <div className="mx-auto flex max-w-3xl items-center justify-end gap-3 px-4 pt-4 text-xs text-stone-500">
          <span>{email}</span>
          <button
            type="button"
            onClick={async () => {
              await createClient().auth.signOut();
              router.push("/login");
              router.refresh();
            }}
            className="underline"
          >
            Sign out
          </button>
        </div>
      )}
      {children}
    </>
  );
}
