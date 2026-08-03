import { describe, expect, it } from "vitest";

import {
  SAFETY_FOLLOW_UP,
  createPriyaInstructions,
  createRealtimeInstructions,
} from "@/lib/priya-prompt";
import { CRISIS_MESSAGE } from "@/lib/safety";
import { DEFAULT_VOICE_PREFERENCE } from "@/types/chat";
import type { RecalledConversation } from "@/types/chat";

const delivery = {
  voice: DEFAULT_VOICE_PREFERENCE.voice,
  pace: DEFAULT_VOICE_PREFERENCE.pace,
  warmth: DEFAULT_VOICE_PREFERENCE.warmth,
  directness: DEFAULT_VOICE_PREFERENCE.directness,
  energy: DEFAULT_VOICE_PREFERENCE.energy,
  responseLength: DEFAULT_VOICE_PREFERENCE.responseLength,
  silenceMs: DEFAULT_VOICE_PREFERENCE.silenceMs,
  useName: false,
};

const recalled: RecalledConversation[] = [
  {
    title: "Dad going quiet at dinner",
    summary: "Their dad barely spoke at dinner. Seeing him again at Christmas.",
    when: "last week",
  },
];

describe("instruction composition", () => {
  it("gives each mode different guidance", () => {
    const listen = createPriyaInstructions("listen");
    const plan = createPriyaInstructions("plan");

    expect(listen).not.toBe(plan);
    expect(listen).toContain("heard, not fixed");
    expect(plan).toContain("already asked for practical advice");
  });

  it("keeps the honesty boundaries in every mode", () => {
    for (const mode of ["listen", "understand", "similar", "plan"] as const) {
      const instructions = createPriyaInstructions(mode);

      expect(instructions).toContain("WHERE THE LINE IS");
      expect(instructions).toContain("You're an AI");
      expect(instructions).toContain("not a substitute for the people");
    }
  });

  it("only includes approved memories that were passed in", () => {
    const withNone = createPriyaInstructions("listen", []);
    const withOne = createPriyaInstructions("listen", ["Has a cat."]);

    expect(withNone).toContain("No approved memories are available.");
    expect(withOne).toContain("Has a cat.");
  });

  it("adds follow-up guidance only when the conversation is holding one", () => {
    expect(createPriyaInstructions("listen", [], false)).not.toContain(
      "WHAT JUST HAPPENED",
    );
    expect(createPriyaInstructions("listen", [], true)).toContain(
      "WHAT JUST HAPPENED",
    );
  });

  it("tells the follow-up not to escalate or recite hotlines", () => {
    expect(SAFETY_FOLLOW_UP).toMatch(/Reciting hotlines again/);
    expect(SAFETY_FOLLOW_UP).toMatch(/plan, a method, or access to means/);
    expect(SAFETY_FOLLOW_UP).toMatch(/reason to escalate/);
  });

  it("includes recalled conversations with instructions to keep them invisible", () => {
    const withRecall = createPriyaInstructions("listen", [], false, recalled);

    expect(withRecall).toContain("Dad going quiet at dinner");
    expect(withRecall).toContain("EARLIER CONVERSATIONS");
    expect(withRecall).toContain("not material to recite");
    expect(createPriyaInstructions("listen")).not.toContain(
      "EARLIER CONVERSATIONS",
    );
  });

  it("carries everything into the realtime instructions too", () => {
    const spoken = createRealtimeInstructions(
      "plan",
      ["Has a cat."],
      delivery,
      "safety_follow_up",
      recalled,
    );

    expect(spoken).toContain("WHERE THE LINE IS");
    expect(spoken).toContain("Has a cat.");
    expect(spoken).toContain("WHAT JUST HAPPENED");
    expect(spoken).toContain("Dad going quiet at dinner");
    expect(spoken).toContain("YOU'RE SPEAKING THIS ALOUD");
  });

  it("restores ordinary instructions once the phase is resolved", () => {
    /*
     * The reason instructions are rebuilt wholesale rather than layered: a
     * crisis fragment could be applied but never taken back.
     */
    const resolved = createRealtimeInstructions(
      "listen",
      [],
      delivery,
      "resolved",
      [],
    );

    expect(resolved).not.toContain("WHAT JUST HAPPENED");
  });

  it("changes delivery without touching the boundaries", () => {
    const direct = createRealtimeInstructions("listen", [], {
      ...delivery,
      directness: "direct",
      responseLength: "brief",
    });

    expect(direct).toContain("Get to the point");
    expect(direct).toContain("Keep turns short");
    expect(direct).toContain("WHERE THE LINE IS");
  });
});

describe("the fixed crisis message", () => {
  it("never claims feelings PRIYA does not have", () => {
    for (const phrase of [
      "I wish",
      "you matter to me",
      "you matter more to me",
      "my heart",
      "I feel",
      "I love",
    ]) {
      expect(CRISIS_MESSAGE.toLowerCase()).not.toContain(
        phrase.toLowerCase(),
      );
    }
  });

  it("still says what it needs to", () => {
    expect(CRISIS_MESSAGE).toContain("I’m an AI");
    expect(CRISIS_MESSAGE).toMatch(/can’t come to you/);
    expect(CRISIS_MESSAGE).toMatch(/danger of acting on this/);
  });
});
