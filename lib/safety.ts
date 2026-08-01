import OpenAI from "openai";

import type { SafetyState } from "@/types/chat";

export const CRISIS_MESSAGE =
  "I’m really glad you told me. Your immediate safety matters more than continuing an ordinary conversation. Please contact someone who can be physically present with you, local emergency services, or an appropriate crisis service now. Are you in immediate danger of acting on these thoughts?";

/**
 * Shown on screen alongside the spoken version. A distressed person will not
 * retain a phone number they only heard once.
 */
export const CRISIS_RESOURCES = [
  {
    region: "US & Canada",
    label: "988 Suicide & Crisis Lifeline",
    contact: "Call or text 988",
  },
  {
    region: "UK & Ireland",
    label: "Samaritans",
    contact: "Call 116 123",
  },
  {
    region: "Anywhere",
    label: "Local emergency services",
    contact: "Call your local emergency number",
  },
  {
    region: "Anywhere",
    label: "Findahelpline.com",
    contact: "Directory of crisis lines by country",
  },
];

export const NOT_AN_EMERGENCY_SERVICE =
  "PRIYA is not an emergency service and cannot contact anyone on your behalf. No one is monitoring this conversation.";

/**
 * Single place the safety classification is decided, so the text route and the
 * voice route can never drift apart on what counts as high risk.
 */
export async function assessSafety(
  openai: OpenAI,
  text: string,
): Promise<SafetyState> {
  const moderation = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });

  const result = moderation.results[0];
  const categories = result?.categories;

  if (
    categories?.["self-harm/intent"] === true ||
    categories?.["self-harm/instructions"] === true
  ) {
    return "high_risk";
  }

  return result?.flagged ? "supportive" : "normal";
}
