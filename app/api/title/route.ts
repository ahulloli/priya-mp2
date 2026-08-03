import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardRequest } from "@/lib/rate-limit";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TITLE_MODEL = process.env.OPENAI_TITLE_MODEL ?? "gpt-5.4-mini";

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
});

const INSTRUCTIONS = `
Two jobs: name this conversation, and write a short note about it for later.

TITLE — the way a person would label it looking back. Three to six words,
sentence case, no quotes, no trailing punctuation.

It should say what the conversation was actually about, specifically enough to
recognise among others: "The interview at Capital One", "Dad going quiet at
dinner", "Feeling behind everyone else".

These titles sit in a list the user scrolls past, sometimes with other people
nearby. When the subject is painful, stay plain and human rather than clinical
or graphic — "A really hard night" rather than anything naming self-harm.
Never sensationalise, never diagnose, and never editorialise about the person.

Write it from their side, not yours. No "user", no "the user's".

SUMMARY — two or three sentences, for PRIYA to read before a future
conversation. What was going on, what mattered to them, and where it was left.
Concrete enough to be useful: names, timings, what they decided.

Write it as durable context, not a transcript. Their passing mood that day
isn't worth recording; an ongoing situation is. Don't interpret them or
speculate about causes, and don't record anything they'd be alarmed to see
resurface — no credentials, no diagnoses they didn't claim themselves.

If the conversation was about being in real distress, say so plainly and
briefly, without detail about method or intent.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
  },
} as const;

/**
 * Names an archived conversation for the list, and writes the summary PRIYA
 * reads before later conversations so she can pick up where things were left.
 */
export async function POST(request: Request) {
  try {
    const blocked = guardRequest(request, "title");

    if (blocked) {
      return blocked;
    }

    const parsed = requestSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const transcript = parsed.data.messages
      .slice(0, 12)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const response = await openai.responses.create({
      model: TITLE_MODEL,
      instructions: INSTRUCTIONS,
      input: transcript,
      text: {
        format: {
          type: "json_schema",
          name: "conversation_title",
          strict: true,
          schema: SCHEMA,
        },
      },
    });

    const { title, summary } = JSON.parse(response.output_text) as {
      title: string;
      summary: string;
    };

    return NextResponse.json({
      title: title.trim().slice(0, 80),
      summary: summary.trim().slice(0, 800),
    });
  } catch (error) {
    console.error("PRIYA title error:", error);

    /* The client already has a usable fallback title; never fail loudly. */
    return NextResponse.json({ title: null, summary: null });
  }
}
