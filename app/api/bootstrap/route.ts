import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Everything the store needs at startup, read on the server.
 *
 * The browser client turned out not to have its session attached when the
 * store first read, so every query went out as the anonymous role and was
 * refused. The server client takes its session from the request cookies, so
 * there is no window in which the read can happen unauthenticated.
 *
 * A failure here is reported as a failure. The caller must never read an error
 * as "this person has no conversations" — doing that archived the conversation
 * they were in and started an empty one, once per sign-in.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    /*
     * getClaims verifies the access token rather than trusting whatever the
     * cookie happens to contain.
     */
    const { data: claims, error: claimsError } =
      await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;

    if (claimsError || !userId) {
      return NextResponse.json(
        { error: "Not authenticated." },
        { status: 401 },
      );
    }

    const [conversations, memories, preference, feedback, reports] =
      await Promise.all([
        supabase
          .from("conversations")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(100),
        supabase.from("memories").select("*").order("created_at"),
        supabase.from("voice_preferences").select("*").maybeSingle(),
        supabase.from("feedback").select("*"),
        supabase.from("reports").select("*"),
      ]);

    const failure =
      conversations.error ??
      memories.error ??
      preference.error ??
      feedback.error ??
      reports.error;

    if (failure) {
      console.error("PRIYA bootstrap failed:", {
        code: failure.code,
        message: failure.message,
        userId,
      });

      return NextResponse.json(
        { error: "Could not load stored data.", code: failure.code },
        { status: 500 },
      );
    }

    const rows = conversations.data ?? [];
    const active = rows.find((row) => row.is_active) ?? null;

    /* Only the active conversation needs its transcript up front. */
    let messages: unknown[] = [];

    if (active) {
      const result = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", active.id)
        .order("created_at", { ascending: true });

      if (result.error) {
        return NextResponse.json(
          { error: "Could not load the conversation.", code: result.error.code },
          { status: 500 },
        );
      }

      messages = result.data ?? [];
    }

    return NextResponse.json({
      activeConversation: active,
      activeMessages: messages,
      archivedConversations: rows.filter((row) => !row.is_active),
      memories: memories.data ?? [],
      voicePreference: preference.data ?? null,
      feedback: feedback.data ?? [],
      reports: reports.data ?? [],
    });
  } catch (error) {
    console.error("PRIYA bootstrap error:", error);

    return NextResponse.json(
      { error: "Could not load stored data." },
      { status: 500 },
    );
  }
}
