"use client";

import { useCallback, useState } from "react";

import ConversationList from "@/components/ConversationList";
import CrisisPanel from "@/components/CrisisPanel";
import DevTools from "@/components/DevTools";
import FeedbackPanel from "@/components/FeedbackPanel";
import FormattedText from "@/components/FormattedText";
import MemoryPanel from "@/components/MemoryPanel";
import VoiceCall from "@/components/VoiceCall";
import VoiceSettings from "@/components/VoiceSettings";
import {
  appendMessage,
  approveMemory,
  createMessage,
  isGreeting,
  approvedMemoryText,
  deleteArchivedConversation,
  deleteMemory,
  editMemory,
  openConversation,
  recalledConversations,
  recordSafetyEvent,
  resetConversation,
  saveFeedback,
  saveReport,
  saveVoicePreference,
  setMode,
  setSafetyPhase,
  usePriyaStore,
} from "@/lib/conversation-store";
import type {
  ChatResponse,
  MemoryCategory,
  PriyaMode,
  SafetyPhase,
  SafetyState,
  SuggestedMemory,
} from "@/types/chat";
import { isActiveSafetyPhase } from "@/types/chat";

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
  const {
    conversation,
    archive,
    memories,
    preference,
    feedback,
    reports,
    writeError,
  } = usePriyaStore();

  const [channel, setChannel] = useState<"text" | "voice">("text");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingMemory, setPendingMemory] = useState<SuggestedMemory | null>(
    null,
  );
  const [reporting, setReporting] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  /*
   * Hiding the panel is a display choice. It does not mean the person is okay,
   * so it never touches the safety phase.
   */
  const [crisisPanelHidden, setCrisisPanelHidden] = useState(false);

  /**
   * One place both channels land: advance the phase, reopen the crisis panel
   * if a disclosure is live, and write the audit row.
   */
  const handleSafetyAssessment = useCallback(
    ({
      safetyState,
      safetyPhase: phase,
      messageId,
    }: {
      safetyState: SafetyState;
      safetyPhase: SafetyPhase;
      messageId: string;
    }) => {
      setSafetyPhase(phase);

      if (isActiveSafetyPhase(phase)) {
        setCrisisPanelHidden(false);
      }

      void recordSafetyEvent(safetyState, phase, "voice", messageId);
    },
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

  const { mode, messages, safetyPhase } = conversation;
  const approved = approvedMemoryText(memories);
  const reportedIds = new Set(reports.map((report) => report.messageId));
  const recalled = recalledConversations(archive);
  /* Scoped to this conversation; the store keeps every conversation's. */
  const conversationFeedback = feedback.filter(
    (entry) => entry.conversationId === conversation.id,
  );

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();

    const cleanInput = input.trim();

    if (!cleanInput || isLoading) {
      return;
    }

    const userMessage = createMessage("user", cleanInput, {
      inputType: "text",
    });

    const nextMessages = [...messages, userMessage];

    /* appendMessage persists the row; updateConversation only writes metadata. */
    appendMessage(userMessage);
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
          safetyPhase,
          recalled,
        }),
      });

      const data = (await response.json()) as ChatResponse | { error: string };

      if (!response.ok || !("message" in data)) {
        throw new Error(
          "error" in data ? data.error : "Unable to receive a response.",
        );
      }

      setSafetyPhase(data.safetyPhase);

      if (isActiveSafetyPhase(data.safetyPhase)) {
        setCrisisPanelHidden(false);
      }

      void recordSafetyEvent(
        data.safetyState,
        data.safetyPhase,
        "text",
        userMessage.id,
      );

      appendMessage(
        createMessage("assistant", data.message, { outputType: "text" }),
      );

      /* A proposal, not a save. It sits in the panel until approved. */
      if (data.suggestMemory) {
        setPendingMemory(data.suggestMemory);
      }
    } catch (caughtError) {
      /*
       * The message stays. They did say it, and it is already stored — taking
       * it back out of the view would leave the screen disagreeing with the
       * database. The draft is not restored either, or sending again would
       * duplicate it.
       */
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

          {writeError && (
            <p
              role="alert"
              className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900"
            >
              {writeError}
            </p>
          )}

          <section className="flex-1 space-y-4 overflow-y-auto p-6">
            {isActiveSafetyPhase(safetyPhase) && !crisisPanelHidden && (
              <CrisisPanel
                onHide={() => setCrisisPanelHidden(true)}
                onResolve={() => {
                  setSafetyPhase("resolved");
                  setCrisisPanelHidden(true);
                }}
              />
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
                  <FormattedText content={message.content} />
                </div>

                <div
                  className={`flex items-center gap-2 text-xs text-stone-400 ${
                    message.role === "user" ? "justify-end" : ""
                  }`}
                >
                  {(message.inputType ?? message.outputType) === "voice" && (
                    <span>spoken</span>
                  )}

                  {message.interrupted && <span>interrupted</span>}

                  {message.role === "assistant" &&
                    !isGreeting(message) && (
                      <button
                        type="button"
                        onClick={() => {
                          setReporting(message.id);
                          setReportReason("");
                        }}
                        className="underline"
                        disabled={reportedIds.has(message.id)}
                      >
                        {reportedIds.has(message.id)
                          ? "Reported"
                          : "Report this response"}
                      </button>
                    )}
                </div>

                {reporting === message.id && (
                  <div className="space-y-2 rounded-xl border border-stone-300 p-3">
                    <label
                      htmlFor={`report-${message.id}`}
                      className="text-sm font-medium"
                    >
                      What was wrong with this response?
                    </label>

                    <textarea
                      id={`report-${message.id}`}
                      value={reportReason}
                      onChange={(event) => setReportReason(event.target.value)}
                      rows={2}
                      maxLength={2000}
                      className="w-full rounded-lg border border-stone-300 p-2 text-sm"
                    />

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!reportReason.trim()}
                        onClick={() => {
                          void saveReport(
                            message.id,
                            message.content,
                            reportReason.trim(),
                          );
                          setReporting(null);
                          setReportReason("");
                        }}
                        className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      >
                        Send report
                      </button>

                      <button
                        type="button"
                        onClick={() => setReporting(null)}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
                preferences={preference}
                history={messages}
                safetyPhase={safetyPhase}
                recalled={recalled}
                onMessage={appendMessage}
                onSafetyAssessment={handleSafetyAssessment}
                onSuggestMemory={setPendingMemory}
                onSwitchToText={switchToText}
              />
            )}
          </div>
        </div>

        <ConversationList
          conversations={archive}
          currentId={conversation.id}
          onOpen={(id) => void openConversation(id)}
          onDelete={(id) => void deleteArchivedConversation(id)}
        />

        <MemoryPanel
          memories={memories}
          pending={pendingMemory}
          onApprove={(summary, category) => {
            void approveMemory(summary, category as MemoryCategory);
            setPendingMemory(null);
          }}
          onDismissPending={() => setPendingMemory(null)}
          onEdit={(id, summary) => void editMemory(id, summary)}
          onDelete={(id) => void deleteMemory(id)}
        />

        <FeedbackPanel
          submittedCount={conversationFeedback.length}
          onSubmit={(entry) => void saveFeedback(entry)}
        />

        <VoiceSettings
          preferences={preference}
          onChange={(next) => void saveVoicePreference(next)}
          disabled={channel === "voice"}
        />

        <DevTools />

        <button
          type="button"
          onClick={() => {
            void resetConversation(mode);
            setCrisisPanelHidden(false);
          }}
          className="self-start text-sm text-stone-500 underline"
        >
          Start a new conversation
        </button>
      </div>
    </main>
  );
}
