import { describe, expect, it } from "vitest";

import {
  needsFollowUpGuidance,
  nextSafetyPhase,
} from "@/lib/safety-phase";
import { isActiveSafetyPhase } from "@/types/chat";

describe("safety phase transitions", () => {
  it("routes a high-risk classification into the immediate check", () => {
    expect(nextSafetyPhase("normal", "high_risk")).toBe(
      "immediate_safety_check",
    );
  });

  it("moves from the immediate check into follow-up on the next turn", () => {
    expect(nextSafetyPhase("immediate_safety_check", "normal")).toBe(
      "safety_follow_up",
    );
  });

  it("stays in follow-up across ordinary turns", () => {
    /*
     * The original bug: follow-up lasted exactly one turn, so the third
     * message after a disclosure was answered as if nothing had happened.
     */
    let phase = nextSafetyPhase("normal", "high_risk");

    for (let turn = 0; turn < 5; turn += 1) {
      phase = nextSafetyPhase(phase, "normal");
    }

    expect(phase).toBe("safety_follow_up");
  });

  it("re-escalates if they disclose again mid follow-up", () => {
    expect(nextSafetyPhase("safety_follow_up", "high_risk")).toBe(
      "immediate_safety_check",
    );
  });

  it("returns to normal only once the user has resolved it", () => {
    expect(nextSafetyPhase("resolved", "normal")).toBe("normal");
  });

  it("does not treat a merely flagged message as a disclosure", () => {
    expect(nextSafetyPhase("normal", "supportive")).toBe("supportive");
    expect(isActiveSafetyPhase("supportive")).toBe(false);
  });

  it("applies follow-up guidance for exactly the holding phases", () => {
    expect(needsFollowUpGuidance("immediate_safety_check")).toBe(true);
    expect(needsFollowUpGuidance("safety_follow_up")).toBe(true);
    expect(needsFollowUpGuidance("resolved")).toBe(false);
    expect(needsFollowUpGuidance("normal")).toBe(false);
    expect(needsFollowUpGuidance("supportive")).toBe(false);
  });
});
