"use client";

import type { Conversation } from "@/types/chat";

type Props = {
  conversations: Conversation[];
  currentId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

function whenLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();

  return sameDay
    ? date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
}

/**
 * Past conversations, newest first. Each one was closed off and named when the
 * app was reopened. Opening one makes it current again so it can be continued.
 */
export default function ConversationList({
  conversations,
  currentId,
  onOpen,
  onDelete,
}: Props) {
  if (conversations.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-2xl border border-stone-200 p-5">
      <h2 className="font-semibold">Earlier conversations</h2>

      <ul className="space-y-1">
        {conversations.map((conversation) => {
          const turns = conversation.messages.filter(
            (message) => message.role === "user",
          ).length;

          return (
            <li
              key={conversation.id}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-stone-50"
            >
              <button
                type="button"
                onClick={() => onOpen(conversation.id)}
                disabled={conversation.id === currentId}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-medium">
                  {conversation.title ?? "Untitled conversation"}
                </span>

                <span className="mt-0.5 block text-xs text-stone-500">
                  {whenLabel(conversation.updatedAt)} · {turns}{" "}
                  {turns === 1 ? "message" : "messages"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onDelete(conversation.id)}
                className="shrink-0 text-xs font-medium text-red-700 underline"
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
