import { createHash } from "node:crypto";

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { proposeMemory } from "@/lib/memory-proposal";
import { createPriyaInstructions } from "@/lib/priya-prompt";
import { guardRequest } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";
import {
  CRISIS_MESSAGE,
  assessSafety,
  needsFollowUpGuidance,
  nextSafetyPhase,
} from "@/lib/safety";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const requestSchema = z.object({
  mode: z.enum(["listen", "understand", "similar", "plan"]),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(5000),
      }),
    )
    .min(1)
    /*
     * Not a conversation limit — conversations are not capped. This only
     * stops a malformed or hostile request from posting an unbounded body,
     * and sits far above any real conversation. A validation failure here
     * would wedge the user permanently, since every retry is longer.
     */
    .max(2000),
  /*
   * Bounds the payload, not the user's memories. A cap they can actually
   * reach would 400 every request until they deleted one — and memories
   * persist, so it would brick the app permanently.
   */
  memories: z.array(z.string().max(500)).max(200).optional(),
  safetyPhase: z
    .enum([
      "normal",
      "supportive",
      "immediate_safety_check",
      "safety_follow_up",
      "resolved",
    ])
    .optional(),
  /* Condensed earlier conversations, newest first. */
  recalled: z
    .array(
      z.object({
        title: z.string().max(120),
        summary: z.string().max(800),
        when: z.string().max(40),
      }),
    )
    .max(20)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const blocked = guardRequest(request, "chat");

    if (blocked) {
      return blocked;
    }

    const user = await getUser();
    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request.",
          details: z.flattenError(parsed.error),
        },
        { status: 400 },
      );
    }

    const {
      mode,
      messages,
      memories = [],
      safetyPhase = "normal",
      recalled = [],
    } = parsed.data;

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user");

    if (!latestUserMessage) {
      return NextResponse.json(
        { error: "A user message is required." },
        { status: 400 },
      );
    }

    /*
     * Safety check before generating the response.
     */
    const safetyState = await assessSafety(openai, latestUserMessage.content);
    const phase = nextSafetyPhase(safetyPhase, safetyState);

    if (safetyState === "high_risk") {
      return NextResponse.json({
        message: CRISIS_MESSAGE,
        safetyState,
        safetyPhase: phase,
        suggestMemory: null,
      });
    }

    /*
     * The whole conversation goes to the model, so PRIYA doesn't quietly
     * forget how it started. Cost grows with length; summarising older turns
     * is the fix when that starts to matter, not truncation.
     */
    const recentMessages = messages;

    /*
     * A disclosure is sticky. It stays in follow-up for as many turns as it
     * takes, until the user says they're okay — not for exactly one turn.
     */
    const inSafetyFollowUp = needsFollowUpGuidance(phase);

    /*
     * The proposal runs alongside the reply rather than after it, so it adds
     * no latency to what the user is waiting for. It is also skipped entirely
     * during a safety follow-up — that is not a moment to ask about storage.
     */
    const [response, suggestMemory] = await Promise.all([
      openai.responses.create({
        model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
        instructions: createPriyaInstructions(
          mode,
          memories,
          inSafetyFollowUp,
          recalled,
        ),
        input: recentMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        /*
         * Derived from the session, never from the request body. A browser
         * can put any id it likes in JSON; it cannot forge a signed cookie.
         */
        safety_identifier: user
          ? createPrivacySafeIdentifier(user.id)
          : undefined,
      }),
      inSafetyFollowUp || safetyState !== "normal"
        ? Promise.resolve(null)
        : proposeMemory(openai, recentMessages, memories),
    ]);

    const output = response.output_text.trim();

    if (!output) {
      throw new Error("The model returned an empty response.");
    }

    return NextResponse.json({
      message: output,
      safetyState,
      safetyPhase: phase,
      suggestMemory,
    });
  } catch (error) {
    console.error("PRIYA chat error:", error);

    return NextResponse.json(
      {
        error:
          "PRIYA could not respond right now. Please try again.",
      },
      { status: 500 },
    );
  }
}

/*
 * One-way hash so that a raw user identifier never leaves the server.
 * Set PRIYA_ID_SALT in .env.local before any real tester uses the app.
 */
function createPrivacySafeIdentifier(userId: string): string {
  const salt = process.env.PRIYA_ID_SALT ?? "priya-local-dev-salt";

  return `priya_${createHash("sha256")
    .update(`${salt}:${userId}`)
    .digest("hex")
    .slice(0, 32)}`;
}
