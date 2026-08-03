import type { Message } from "@/types/chat";

/**
 * Picks which turns a summary is written from.
 *
 * Taking the first N was wrong in the way that matters most: how a
 * conversation *ended* — the decision reached, the next step agreed, whether a
 * disclosure was resolved — lives at the bottom. These summaries come back to
 * PRIYA as recalled context, so a summary describing only the opening produces
 * confidently stale continuity.
 *
 * Keeping a little of the opening preserves what the conversation was about;
 * weighting the end preserves where it got to. A rolling summary would beat
 * both, and is the upgrade once conversations run long.
 */
export function summaryWindow<T extends Pick<Message, "role" | "content">>(
  messages: T[],
  limit = 24,
): T[] {
  if (messages.length <= limit) {
    return messages;
  }

  const opening = Math.floor(limit / 4);

  return [...messages.slice(0, opening), ...messages.slice(-(limit - opening))];
}
