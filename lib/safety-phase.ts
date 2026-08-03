import type { SafetyPhase, SafetyState } from "@/types/chat";
import { isActiveSafetyPhase } from "@/types/chat";

/*
 * Pure phase logic, deliberately free of any server-only import. Both the
 * text route and the browser's voice session compute transitions with this,
 * which is what stops the two channels disagreeing about whether a
 * disclosure is still open.
 */

/**
 * A disclosure is sticky. Once a conversation is holding one, an ordinary
 * message does not end it — only the user does, by saying they're okay.
 */
export function nextSafetyPhase(
  current: SafetyPhase,
  latest: SafetyState,
): SafetyPhase {
  if (latest === "high_risk") {
    return "immediate_safety_check";
  }

  if (current === "immediate_safety_check") {
    return "safety_follow_up";
  }

  if (current === "safety_follow_up") {
    /* Stays here for as many turns as it takes. */
    return "safety_follow_up";
  }

  return latest === "supportive" ? "supportive" : "normal";
}

/**
 * Whether a spoken response may be created, given whether the instruction
 * resync actually landed.
 *
 * A voice session keeps whatever instructions it last accepted. If the resync
 * fails on an ordinary turn, PRIYA answers with slightly stale framing — a
 * nuisance. If it fails on the turn a disclosure is detected, she answers a
 * crisis with the instructions she had before it, which is the failure this
 * whole gate exists to prevent. So the safety phases fail closed: no
 * instructions, no response.
 */
export function canCreateSpokenResponse(
  phase: SafetyPhase,
  instructionsApplied: boolean,
): boolean {
  return instructionsApplied || !isActiveSafetyPhase(phase);
}

/** Whether PRIYA should be given the follow-up guidance this turn. */
export function needsFollowUpGuidance(phase: SafetyPhase): boolean {
  return isActiveSafetyPhase(phase);
}
