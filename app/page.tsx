"use client";

import { useCallback, useState } from "react";

import CrisisPanel from "@/components/CrisisPanel";
import MemoryPanel from "@/components/MemoryPanel";
import VoiceCall from "@/components/VoiceCall";
import VoiceSettings from "@/components/VoiceSettings";
import {
  appendMessage,
  approveMemory,
  approvedMemoryText,
  deleteMemory,
  resetConversation,
  saveVoicePreferences,
  setMode,
  updateConversation,
  usePriyaStore,
} from "@/lib/conversation-store";
import type {
  ChatMessage,
  ChatResponse,
  PriyaMode,
  SafetyState,
} from "@/types/chat";

const MODES: Array<{ id: PriyaMode; title: string; description: string }> = [
  { id: "listen", title: "Listen", description: "Give me space to talk." },
  {
    id: "understand",
    title: "Understand",
    description: "Help me make sense of this.",
  },
  {
    id: "similar",
    title: "Similar experiences",
    description: "Show me relevant patterns.",
  },
  {
    id: "plan",
    title: "Make a plan",
    description: "Help me choose a next step.",
  },
];

export default function HomePage() {
  const { conversation, memories, preferences } = usePriyaStore();

  const [channel, setChannel] = useState<"text" | "voice">("text");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [safetyState, setSafetyState] = useState<SafetyState>("normal");
  const [pendingMemory, setPendingMemory] = useState<string | null>(null);
  const [reported, setReported] = useState<string[]>([]);

  const handleSafetyState = useCallback(
    (state: SafetyState) => setSafetyState(state),
    [],
  );

  const switchToText = useCallback(() => setChannel("text"), []);

  /* Null until the store has read localStorage on the client. */
  if (!conversation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-stone-50 text-stone-500">
        Loading…
      </main>
    );
  }

  const { mode, messages } = conversation;
  const approved = approvedMemoryText(memories);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();

    const cleanInput = input.trim();

    if (!cleanInput || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: cleanInput,
      input_type: "text",
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];

    updateConversation((current) => ({
      ...current,
      messages: nextMessages,
    }));
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          messages: nextMessages.map(({ role, content }) => ({
            role,
            content,
          })),
          memories: approved,
          userId: "local-test-user",
        }),
      });

      const data = (await response.json()) as ChatResponse | { error: string };

      if (!response.ok || !("message" in data)) {
        throw new Error(
          "error" in data ? data.error : "Unable to receive a response.",
        );
      }

      setSafetyState(data.safetyState);
      appendMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.message,
        output_type: "text",
        safetyState: data.safetyState,
        createdAt: new Date().toISOString(),
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Something went wrong.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
          <header className="border-b border-stone-200 p-6">
            <p className="text-sm font-medium uppercase tracking-widest text-stone-500">
              Personalized Relational Intelligence, Your Ally
            </p>

            <h1 className="mt-2 text-3xl font-semibold">PRIYA</h1>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={`rounded-2xl border p-3 text-left transition ${
                    mode === item.id
                      ? "border-stone-900 bg-stone-900 text-white"
                      : "border-stone-200 hover:bg-stone-50"
                  }`}
                >
                  <span className="block font-medium">{item.title}</span>
                  <span className="mt-1 block text-sm opacity-75">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              {(["text", "voice"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setChannel(option)}
                  className={`rounded-xl border px-4 py-2 text-sm font-medium capitalize ${
                    channel === option
                      ? "border-stone-900 bg-stone-100"
                      : "border-stone-200"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </header>

          <section className="flex-1 space-y-4 overflow-y-auto p-6">
            {safetyState === "high_risk" && (
              <CrisisPanel onDismiss={() => setSafetyState("normal")} />
            )}

            {messages.map((message) => (
              <div key={message.id} className="space-y-1">
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    message.role === "user"
                      ? "ml-auto bg-stone-900 text-white"
                      : "bg-stone-100 text-stone-900"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-7">
                    {message.content}
                  </p>
                </div>

                <div
                  className={`flex items-center gap-2 text-xs text-stone-400 ${
                    message.role === "user" ? "justify-end" : ""
                  }`}
                >
                  {(message.input_type ?? message.output_type) === "voice" && (
                    <span>spoken</span>
                  )}

                  {message.interrupted && <span>interrupted</span>}

                  {message.role === "assistant" &&
                    message.id !== "priya-greeting" && (
                      <button
                        type="button"
                        onClick={() =>
                          setReported((current) => [...current, message.id])
                        }
                        className="underline"
                      >
                        {reported.includes(message.id)
                          ? "Reported"
                          : "Report this response"}
                      </button>
                    )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="max-w-[85%] rounded-2xl bg-stone-100 px-4 py-3">
                PRIYA is thinking…
              </div>
            )}

            {error && (
              <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </section>

          <div className="border-t border-stone-200 p-4">
            {channel === "text" ? (
              <form onSubmit={sendMessage} className="flex gap-3">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Tell PRIYA what is happening…"
                  maxLength={5000}
                  rows={2}
                  className="min-h-14 flex-1 resize-none rounded-2xl border border-stone-300 px-4 py-3 outline-none focus:border-stone-900"
                />

                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="rounded-2xl bg-stone-900 px-5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            ) : (
              <VoiceCall
                mode={mode}
                memories={approved}
                preferences={preferences}
                onMessage={appendMessage}
                onSafetyState={handleSafetyState}
                onSwitchToText={switchToText}
              />
            )}
          </div>
        </div>

        <MemoryPanel
          memories={memories}
          pending={pendingMemory}
          onApprove={(summary) => {
            approveMemory(summary);
            setPendingMemory(null);
          }}
          onDismissPending={() => setPendingMemory(null)}
          onDelete={deleteMemory}
        />

        <VoiceSettings
          preferences={preferences}
          onChange={saveVoicePreferences}
          disabled={channel === "voice"}
        />

        <button
          type="button"
          onClick={() => {
            resetConversation(mode);
            setSafetyState("normal");
          }}
          className="self-start text-sm text-stone-500 underline"
        >
          Start a new conversation
        </button>
      </div>
    </main>
  );
}
