import { NextResponse } from "next/server";
import { z } from "zod";

import { createRealtimeInstructions } from "@/lib/priya-prompt";
import { guardRequest } from "@/lib/rate-limit";
import { REALTIME_VOICES } from "@/types/chat";

const REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime-2.1";

const requestSchema = z.object({
  mode: z.enum(["listen", "understand", "similar", "plan"]),
  memories: z.array(z.string().max(500)).max(20).optional(),
  safetyPhase: z
    .enum([
      "normal",
      "supportive",
      "immediate_safety_check",
      "safety_follow_up",
      "resolved",
    ])
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
 * Mints a short-lived client secret so the browser can open its own WebRTC
 * connection to OpenAI. The standing API key never leaves the server.
 */
export async function POST(request: Request) {
  try {
    const blocked = guardRequest(request, "realtimeSession");

    if (blocked) {
      return blocked;
    }

    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request.", details: z.flattenError(parsed.error) },
        { status: 400 },
      );
    }

    const {
      mode,
      memories = [],
      preferences,
      safetyPhase = "normal",
    } = parsed.data;

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            /*
             * The phase travels with the session, so a voice call opened
             * during an unresolved disclosure starts already holding it
             * instead of greeting the user as if nothing happened.
             */
            instructions: createRealtimeInstructions(
              mode,
              memories,
              preferences,
              safetyPhase,
            ),
            audio: {
              input: {
                /*
                 * Transcription is what makes the safety gate possible at all:
                 * moderation runs on these transcripts as they land.
                 */
                transcription: { model: "gpt-4o-mini-transcribe" },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  silence_duration_ms: preferences.silenceMs,
                  /*
                   * The gate. PRIYA does not answer when the user stops
                   * talking — the client moderates the finished transcript
                   * first and only then sends response.create. Without this
                   * she would already be speaking when the verdict lands.
                   */
                  create_response: false,
                  /* Barge-in still works: talking over her cancels her turn. */
                  interrupt_response: true,
                },
              },
              output: {
                voice: preferences.voice,
                speed: preferences.pace,
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("PRIYA realtime session error:", response.status, detail);

      return NextResponse.json(
        { error: "Could not start a voice session." },
        { status: 502 },
      );
    }

    const session = await response.json();

    return NextResponse.json({
      clientSecret: session.value,
      expiresAt: session.expires_at,
      model: REALTIME_MODEL,
    });
  } catch (error) {
    console.error("PRIYA realtime session error:", error);

    return NextResponse.json(
      { error: "Could not start a voice session." },
      { status: 500 },
    );
  }
}
