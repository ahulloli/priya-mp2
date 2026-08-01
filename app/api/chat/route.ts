import { createHash } from "node:crypto";

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createPriyaInstructions } from "@/lib/priya-prompt";
import { CRISIS_MESSAGE, assessSafety } from "@/lib/safety";

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
    .max(30),
  memories: z.array(z.string().max(500)).max(20).optional(),
  userId: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
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
      userId,
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

    if (safetyState === "high_risk") {
      return NextResponse.json({
        message: CRISIS_MESSAGE,
        safetyState: "high_risk",
        suggestMemory: null,
      });
    }

    /*
     * Only send the most recent turns during the prototype.
     * This helps control cost and keeps the context focused.
     */
    const recentMessages = messages.slice(-16);

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      instructions: createPriyaInstructions(mode, memories),
      input: recentMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      safety_identifier: userId
        ? createPrivacySafeIdentifier(userId)
        : undefined,
    });

    const output = response.output_text.trim();

    if (!output) {
      throw new Error("The model returned an empty response.");
    }

    return NextResponse.json({
      message: output,
      safetyState,
      suggestMemory: null,
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
