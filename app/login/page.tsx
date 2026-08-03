"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    const supabase = createClient();

    const { data, error: authError } =
      mode === "signIn"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    setBusy(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (!data.session) {
      /* Sign-up with email confirmation on: there's nothing to log in to yet. */
      setNotice("Check your email to confirm the account, then sign in.");
      setMode("signIn");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-50 px-4 text-stone-900">
      <div className="w-full max-w-sm space-y-6 rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-stone-500">
            Personalized Relational Intelligence, Your Ally
          </p>
          <h1 className="mt-1 text-2xl font-semibold">PRIYA</h1>
          <p className="mt-3 text-sm text-stone-600">
            {mode === "signIn"
              ? "Sign in to pick up where you left off."
              : "Create an account so your conversations are there next time."}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-300 p-2.5"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-xl border border-stone-300 p-2.5"
            />
            {mode === "signUp" && (
              <span className="mt-1 block text-xs text-stone-500">
                At least 8 characters.
              </span>
            )}
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-stone-900 px-4 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy
              ? "Working…"
              : mode === "signIn"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {error && (
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {notice && (
          <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">
            {notice}
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signIn" ? "signUp" : "signIn");
            setError("");
            setNotice("");
          }}
          className="text-sm text-stone-600 underline"
        >
          {mode === "signIn"
            ? "No account yet? Create one"
            : "Already have an account? Sign in"}
        </button>

        <p className="text-xs text-stone-500">
          PRIYA is not a crisis service and cannot contact anyone on your
          behalf.
        </p>
      </div>
    </main>
  );
}
