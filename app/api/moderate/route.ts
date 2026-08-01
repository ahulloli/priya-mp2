import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { CRISIS_MESSAGE, assessSafety } from "@/lib/safety";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const requestSchema = z.object({
  text: z.string().trim().min(1).max(5000),
});

/**
 * The safety gate for voice. The browser holds the audio connection directly,
 * so every transcript that comes back gets posted here as it lands. A
 * high_risk verdict tells the client to cut PRIYA off mid-sentence and show
 * the crisis panel.
 *
 * This is reactive, not preventive: PRIYA may already have spoken a sentence
 * before the verdict arrives. The text route still gates before generating.
 */
export async function POST(request: Request) {
  try {
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
