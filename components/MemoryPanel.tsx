"use client";

import { useState } from "react";

import type { Memory } from "@/types/chat";

type Props = {
  memories: Memory[];
  /** Text PRIYA proposed, awaiting an explicit yes. Null when nothing is pending. */
  pending: string | null;
  onApprove: (summary: string) => void;
  onDismissPending: () => void;
  onDelete: (id: string) => void;
};

/**
 * Nothing reaches storage without passing through here first. The user sees
 * the exact text before it is saved, and can edit it.
 */
export default function MemoryPanel({
  memories,
  pending,
  onApprove,
  onDismissPending,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const proposal = editing ?? pending;

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 p-5">
      <div>
        <h2 className="font-semibold">What PRIYA remembers</h2>
        <p className="mt-1 text-sm text-stone-600">
          Only things you have explicitly approved. Nothing is saved on its own.
        </p>
      </div>

      {pending !== null && (
        <div className="space-y-3 rounded-xl border border-stone-300 bg-stone-50 p-4">
          <p className="text-sm font-medium">
            Would you like PRIYA to remember this?
          </p>

          {editing === null ? (
            <p className="rounded-lg bg-white p-3 text-sm italic">
              “{pending}”
            </p>
          ) : (
            <textarea
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-stone-300 p-3 text-sm"
            />
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onApprove(proposal ?? "");
                setEditing(null);
              }}
              className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white"
            >
              Remember this
            </button>

            <button
              type="button"
              onClick={() => {
                onDismissPending();
                setEditing(null);
              }}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm"
            >
              Not now
            </button>

            {editing === null && (
              <button
                type="button"
                onClick={() => setEditing(pending)}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      )}

      {memories.length > 0 ? (
        <ul className="space-y-2">
          {memories.map((memory) => (
            <li
              key={memory.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-stone-50 p-3"
            >
              <span className="text-sm">{memory.summary}</span>

              <button
                type="button"
                onClick={() => onDelete(memory.id)}
                className="shrink-0 text-xs font-medium text-red-700 underline"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-stone-500">Nothing saved yet.</p>
      )}

      <div className="space-y-2 border-t border-stone-200 pt-4">
        <label htmlFor="memory-draft" className="text-sm font-medium">
          Save something yourself
        </label>

        <textarea
          id="memory-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Something you want PRIYA to keep in mind…"
          rows={2}
          maxLength={500}
          className="w-full rounded-xl border border-stone-300 p-3 text-sm"
        />

        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => {
            onApprove(draft);
            setDraft("");
          }}
          className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Save as memory
        </button>
      </div>
    </section>
  );
}
