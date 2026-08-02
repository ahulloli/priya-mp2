import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { proposeMemory } from "@/lib/memory-proposal";
import { guardRequest } from "@/lib/rate-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const requestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(5000),
      }),
    )
    .min(1)
    .max(2000),
  memories: z.array(z.string().max(500)).max(20).optional(),
});

/**
 * Memory proposals for spoken turns. The text route runs this inline next to
 * the reply, but voice generates its reply inside the Realtime session where
 * there is no server round trip to piggyback on — so the client calls this
 * once a spoken exchange completes.
 *
 * Proposal only. Storage still requires the user to press Remember this.
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

    const suggestMemory = await proposeMemory(
      openai,
      parsed.data.messages,
      parsed.data.memories ?? [],
    );

    return NextResponse.json({ suggestMemory });
  } catch (error) {
    console.error("PRIYA memory proposal error:", error);

    /* A missing proposal is a non-event; never surface it as a failure. */
    return NextResponse.json({ suggestMemory: null });
  }
}
