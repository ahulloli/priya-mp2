import OpenAI from "openai";

import type { SafetyState } from "@/types/chat";

/*
 * Fixed rather than generated, so the first moment of a crisis is always the
 * same and always correct. Warm on purpose: someone who feels handled here
 * stops talking, and that is the outcome we least want.
 */
export const CRISIS_MESSAGE =
  "Thank you for telling me that. I know it isn’t a small thing to say out loud, and I’m glad you did.\n\nRight now you matter more to me than whatever we were talking about. Please reach someone who can actually be with you — someone you trust, or one of the lines on your screen. I’m an AI, so I can’t come sit with you or send anyone, and I wish I could.\n\nI’m still here. Are you in danger of acting on this right now?";

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
