import OpenAI from "openai";

import type { ChatMessage, SuggestedMemory } from "@/types/chat";
import { MEMORY_CATEGORIES } from "@/types/chat";

const MEMORY_MODEL = process.env.OPENAI_MEMORY_MODEL ?? "gpt-5.4-mini";

const INSTRUCTIONS = `
You watch a conversation and decide whether one durable fact is worth keeping
for future conversations. Almost always the answer is no.

Worth proposing:
- A significant upcoming event, with its timing.
- A long-term goal they are working toward.
- An ongoing challenge that will still be true next month.
- A stable preference for how they want to be talked to.
- An important relationship, described plainly.
- A decision they have said they want to come back to.

Never propose:
- How they feel right now, or any passing emotion.
- Every fact that happened to be mentioned.
- Passwords, addresses, financial details, or identification numbers.
- Health, sexuality, religion, immigration status, or similar sensitive
  details — leave those for the user to save themselves if they want to.
- Your own interpretation of them. Only what they actually said.
- Anything already covered by the existing memories you were given.

Write the text addressed to them, in second person, as a plain fact with no
emotional colouring: "You have a final interview with Capital One next
Thursday." Not "You are nervous about your interview."

The reason is one short sentence on why remembering it would help them later.

When nothing qualifies, set suggest to false and leave text empty.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggest", "text", "category", "reason"],
  properties: {
    suggest: { type: "boolean" },
    text: { type: "string" },
    category: { type: "string", enum: [...MEMORY_CATEGORIES, "none"] },
    reason: { type: "string" },
  },
} as const;

/**
 * Runs alongside the main reply rather than after it, so proposing a memory
 * costs no extra latency. Failures are swallowed: a missing proposal is a
 * non-event, and it must never take down the conversation.
 */
export async function proposeMemory(
  openai: OpenAI,
  messages: Pick<ChatMessage, "role" | "content">[],
  existingMemories: string[],
): Promise<SuggestedMemory | null> {
  try {
    const transcript = messages
      .slice(-6)
      .map((message) => `${message.role}: ${message.content}`)
      .join("\n");

    const existing =
      existingMemories.length > 0
        ? existingMemories.map((memory) => `- ${memory}`).join("\n")
        : "(none yet)";

    const response = await openai.responses.create({
      model: MEMORY_MODEL,
      instructions: INSTRUCTIONS,
      input: `EXISTING MEMORIES:\n${existing}\n\nCONVERSATION:\n${transcript}`,
      text: {
        format: {
          type: "json_schema",
          name: "memory_proposal",
          strict: true,
          schema: SCHEMA,
        },
      },
    });

    const parsed = JSON.parse(response.output_text) as {
      suggest: boolean;
      text: string;
      category: string;
      reason: string;
    };

    if (
      !parsed.suggest ||
      !parsed.text.trim() ||
      !MEMORY_CATEGORIES.includes(
        parsed.category as (typeof MEMORY_CATEGORIES)[number],
      )
    ) {
      return null;
    }

    return {
      text: parsed.text.trim(),
      category: parsed.category as SuggestedMemory["category"],
      reason: parsed.reason.trim(),
    };
  } catch (error) {
    console.error("PRIYA memory proposal error:", error);
    return null;
  }
}
