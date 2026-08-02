import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardRequest } from "@/lib/rate-limit";
import { CRISIS_MESSAGE, assessSafety } from "@/lib/safety";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const requestSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

/**
 * The safety gate for voice, and it gates *before* PRIYA speaks.
 *
 * The Realtime session is configured with turn_detection.create_response set
 * to false, so ending a turn does not trigger a reply on its own. The client
 * posts the finished transcript here and only sends response.create once this
 * has answered. Nothing is spoken before classification.
 *
 * If you are tempted to "fix" this by re-enabling create_response: don't.
 * That is the bug this design exists to prevent.
 */
export async function POST(request: Request) {
  try {
    const blocked = guardRequest(request, "moderate");

    if (blocked) {
      return blocked;
    }

    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request." },
        { status: 400 },
      );
    }

    const safetyState = await assessSafety(openai, parsed.data.text);

    return NextResponse.json({
      safetyState,
      crisisMessage: safetyState === "high_risk" ? CRISIS_MESSAGE : undefined,
    });
  } catch (error) {
    console.error("PRIYA moderation error:", error);

    /*
     * Failing open would silently disable the gate. Say so instead, and let
     * the client decide (it surfaces a warning rather than pretending we
     * checked).
     */
    return NextResponse.json(
      { error: "Safety check unavailable." },
      { status: 500 },
    );
  }
}
