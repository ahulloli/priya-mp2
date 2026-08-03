import { NextResponse } from "next/server";
import { z } from "zod";

import { createRealtimeInstructions } from "@/lib/priya-prompt";
import { guardRequest } from "@/lib/rate-limit";
import { REALTIME_VOICES, SAFETY_PHASES } from "@/types/chat";

const requestSchema = z.object({
  mode: z.enum(["listen", "understand", "similar", "plan"]),
  memories: z.array(z.string().max(500)).max(200).optional(),
  safetyPhase: z.enum(SAFETY_PHASES as [string, ...string[]]).optional(),
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
  preferences: z.object({
    voice: z.enum(REALTIME_VOICES),
    pace: z.number().min(0.7).max(1.2),
    warmth: z.enum(["reserved", "balanced", "very_warm"]),
    directness: z.enum(["gentle", "balanced", "direct"]),
    energy: z.enum(["calm", "balanced", "upbeat"]),
    responseLength: z.enum(["brief", "balanced", "thorough"]),
    silenceMs: z.number().min(200).max(3000),
    useName: z.boolean(),
    name: z.string().max(80).optional(),
  }),
});

/**
 * Rebuilds the full instruction set for a call that is already running.
 *
 * Deliberately a route rather than a client-side builder: it keeps PRIYA's
 * prompts out of the browser bundle, and guarantees a live session is handed
 * byte-identical instructions to the ones it started with — the same reason
 * the safety phase machine is shared rather than reimplemented.
 */
export async function POST(request: Request) {
  try {
    const blocked = guardRequest(request, "chat");

    if (blocked) {
      return blocked;
    }

    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const {
      mode,
      memories = [],
      preferences,
      safetyPhase = "normal",
      recalled = [],
    } = parsed.data;

    return NextResponse.json({
      instructions: createRealtimeInstructions(
        mode,
        memories,
        preferences,
        safetyPhase as never,
        recalled,
      ),
    });
  } catch (error) {
    console.error("PRIYA realtime instructions error:", error);

    return NextResponse.json(
      { error: "Could not rebuild instructions." },
      { status: 500 },
    );
  }
}
