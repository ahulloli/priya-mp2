import OpenAI from "openai";

import type { SafetyState } from "@/types/chat";

/*
 * Fixed rather than generated, so the first moment of a crisis is always the
 * same and always correct. Warm on purpose — someone who feels handled here
 * stops talking — but every warm line has to be literally true of an AI.
 * No claimed feelings, no "I wish", no "you matter to me".
 */
export const CRISIS_MESSAGE =
  "Thank you for telling me. I know that isn’t a small thing to say out loud.\n\nRight now your safety matters more than anything else we were talking about. Please reach someone who can actually be with you — someone you trust, or one of the lines on your screen. I’m an AI, so I can’t come to you or contact anyone on your behalf, but I can stay in this conversation and help you work out who to reach.\n\nI’m still here. Are you in danger of acting on this right now?";

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

/* Phase transitions live in safety-phase.ts so the browser can import them
 * without pulling in the OpenAI SDK. Re-exported here for server callers. */
export { needsFollowUpGuidance, nextSafetyPhase } from "@/lib/safety-phase";
