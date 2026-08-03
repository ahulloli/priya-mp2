"use client";

import { useState } from "react";

import { clearAll, exportAll } from "@/lib/conversation-store";

/**
 * Local data controls for testing. Export before changing shapes so a bad
 * migration is recoverable, and clear to start from nothing.
 *
 * Clearing is destructive and irreversible, so it asks twice.
 */
export default function DevTools() {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");

  async function download() {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `priya-export-${data.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);

    setStatus(
      `Exported ${data.conversations.length} conversations, ${data.messages.length} messages, ${data.memories.length} memories.`,
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-dashed border-stone-300 p-5">
      <div>
        <h2 className="font-semibold">Local data</h2>
        <p className="mt-1 text-sm text-stone-600">
          Everything lives in this browser only. Export before changing
          anything you can’t rebuild.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void download()}
          className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium"
        >
          Export local data
        </button>

        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => {
                void clearAll();
                setConfirming(false);
                setStatus("All local data cleared.");
              }}
              className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white"
            >
              Yes, delete everything
            </button>

            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-xl border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
          >
            Clear all local data
          </button>
        )}
      </div>

      {confirming && (
        <p className="text-sm text-red-800">
          This deletes every conversation, memory, and piece of feedback on this
          device. It cannot be undone.
        </p>
      )}

      {status && <p className="text-sm text-stone-600">{status}</p>}
    </section>
  );
}
