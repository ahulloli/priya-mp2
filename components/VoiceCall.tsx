"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createMessage } from "@/lib/conversation-store";
import { nextSafetyPhase } from "@/lib/safety-phase";
import type {
  Message,
  PriyaMode,
  RecalledConversation,
  SafetyPhase,
  SafetyState,
  SuggestedMemory,
  VoicePreference,
} from "@/types/chat";
import { isActiveSafetyPhase } from "@/types/chat";

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type Props = {
  mode: PriyaMode;
  memories: string[];
  preferences: VoicePreference;
  /** Everything said so far, in either channel, to seed the session. */
  history: Message[];
  /** The conversation's phase. This component keeps no safety state of its own. */
  safetyPhase: SafetyPhase;
  /** Condensed earlier conversations, so voice has the same continuity. */
  recalled: RecalledConversation[];
  onMessage: (message: Message) => void;
  onSafetyPhase: (phase: SafetyPhase) => void;
  onSuggestMemory: (memory: SuggestedMemory) => void;
  onSwitchToText: () => void;
};

const STATUS_COPY: Record<VoiceStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  listening: "PRIYA is listening",
  thinking: "PRIYA is thinking",
  speaking: "PRIYA is speaking",
  error: "Something went wrong",
};

/*
 * Cancelling a response that the server already cancelled is normal and
 * expected — the user talking over PRIYA triggers both. These must not be
 * surfaced as connection failures.
 */
const BENIGN_ERROR_PATTERN =
  /cancel|no active response|already|truncat|not found/i;

export default function VoiceCall({
  mode,
  memories,
  preferences,
  history,
  safetyPhase,
  recalled,
  onMessage,
  onSafetyPhase,
  onSuggestMemory,
  onSwitchToText,
}: Props) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState("");
  const [safetyWarning, setSafetyWarning] = useState("");
  const [liveUser, setLiveUser] = useState("");
  const [livePriya, setLivePriya] = useState("");

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Whether the current PRIYA turn was cut off by the user. */
  const interruptedRef = useRef(false);
  /* The assistant item currently playing, and when its audio started. */
  const speakingItemRef = useRef<{ id: string; startedAt: number } | null>(
    null,
  );

  /*
   * Latest props for use inside long-lived callbacks. Reading the phase from
   * a ref keeps it current without tearing down the session on every change,
   * but the value still originates from the conversation, not from here.
   */
  const phaseRef = useRef(safetyPhase);
  const historyRef = useRef(history);
  const memoriesRef = useRef(memories);
  const modeRef = useRef(mode);
  const preferencesRef = useRef(preferences);
  const recalledRef = useRef(recalled);

  useEffect(() => {
    phaseRef.current = safetyPhase;
    historyRef.current = history;
    memoriesRef.current = memories;
    modeRef.current = mode;
    preferencesRef.current = preferences;
    recalledRef.current = recalled;
  }, [safetyPhase, history, memories, mode, preferences, recalled]);

  const send = useCallback((event: Record<string, unknown>) => {
    const channel = channelRef.current;

    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(event));
    }
  }, []);

  /**
   * Tells the model how much of its own turn was actually heard. Without this
   * it believes the user heard the whole reply, and the next turn answers a
   * sentence that never reached them.
   *
   * The server has already cancelled generation itself (interrupt_response is
   * on), so this truncates rather than cancelling a second time.
   */
  const truncateSpokenTurn = useCallback(() => {
    const speaking = speakingItemRef.current;

    if (!speaking) {
      return;
    }

    send({
      type: "conversation.item.truncate",
      item_id: speaking.id,
      content_index: 0,
      audio_end_ms: Math.max(0, Date.now() - speaking.startedAt),
    });

    speakingItemRef.current = null;
  }, [send]);

  /** Asks for a memory proposal once a spoken exchange has completed. */
  const requestMemoryProposal = useCallback(async () => {
    try {
      const response = await fetch("/api/memory-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyRef.current.map(({ role, content }) => ({
            role,
            content,
          })),
          memories: memoriesRef.current,
        }),
      });

      if (!response.ok) {
        return;
      }

      const { suggestMemory } = (await response.json()) as {
        suggestMemory: SuggestedMemory | null;
      };

      if (suggestMemory) {
        onSuggestMemory(suggestMemory);
      }
    } catch {
      /* A missing proposal is a non-event. */
    }
  }, [onSuggestMemory]);

  /**
   * Rebuilds and reapplies the entire instruction set on a running call.
   *
   * A live session keeps whatever instructions it was created with, so any
   * change the user makes mid-call — switching to Plan, approving a memory,
   * changing how PRIYA sounds, resolving a crisis — would otherwise not reach
   * her until the next call. Sending the whole set rather than a fragment is
   * what makes it reversible.
   */
  const syncInstructions = useCallback(
    async (phase: SafetyPhase = phaseRef.current) => {
      const channel = channelRef.current;

      if (channel?.readyState !== "open") {
        return;
      }

      try {
        const response = await fetch("/api/realtime/instructions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: modeRef.current,
            memories: memoriesRef.current,
            preferences: preferencesRef.current,
            safetyPhase: phase,
            recalled: recalledRef.current,
          }),
        });

        if (!response.ok) {
          return;
        }

        const { instructions } = (await response.json()) as {
          instructions: string;
        };

        send({
          type: "session.update",
          session: { type: "realtime", instructions },
        });
      } catch {
        /* The session keeps its previous instructions; not worth interrupting. */
      }
    },
    [send],
  );

  /*
   * Anything PRIYA is told about gets pushed to the live session when it
   * changes. safetyPhase is handled inside the gate instead, so that the new
   * instructions are in place before the response is requested.
   */
  useEffect(() => {
    void syncInstructions();
  }, [mode, memories, preferences, recalled, syncInstructions]);

  /**
   * The gate. The session sets create_response: false, so nothing is spoken
   * until this runs and explicitly asks for a reply. Every path either creates
   * a response after a verdict, or leaves the turn unanswered.
   */
  const moderateThenRespond = useCallback(
    async (text: string) => {
      let safetyState: SafetyState;

      try {
        const response = await fetch("/api/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          throw new Error("Safety check unavailable.");
        }

        ({ safetyState } = (await response.json()) as {
          safetyState: SafetyState;
        });
      } catch {
        /* Failing open would mean speaking without having checked. */
        setSafetyWarning(
          "PRIYA couldn’t run her safety check, so she didn’t reply to that. Please try again, or switch to text.",
        );
        setStatus("listening");
        return;
      }

      const phase = nextSafetyPhase(phaseRef.current, safetyState);

      phaseRef.current = phase;
      onSafetyPhase(phase);

      /*
       * Resend the whole instruction set rather than layering a crisis
       * fragment on top. Layering was one-way: once a crisis fragment was
       * applied there was nothing to put back, so a resolved conversation
       * kept its crisis framing for the rest of the call.
       */
      await syncInstructions(phase);

      send({ type: "response.create" });
    },
    [onSafetyPhase, send, syncInstructions],
  );

  const disconnect = useCallback(() => {
    peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerRef.current?.close();
    peerRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    channelRef.current = null;
    speakingItemRef.current = null;
    setStatus("idle");
    setLiveUser("");
    setLivePriya("");
  }, []);

  /* A live mic must never outlive the component. */
  useEffect(() => disconnect, [disconnect]);

  const handleEvent = useCallback(
    (event: {
      type: string;
      transcript?: string;
      delta?: string;
      item_id?: string;
      error?: { message?: string; code?: string; type?: string };
    }) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started":
          /*
           * They started talking. interrupt_response already had the server
           * cancel PRIYA's turn, so cancelling again here would race it — we
           * only need to record how much was heard.
           */
          setStatus((current) => {
            if (current === "speaking") {
              interruptedRef.current = true;
              truncateSpokenTurn();
            }
            return "listening";
          });
          setLivePriya("");
          break;

        case "input_audio_buffer.speech_stopped":
          setStatus("thinking");
          break;

        case "conversation.item.input_audio_transcription.delta":
          setLiveUser((current) => current + (event.delta ?? ""));
          break;

        case "conversation.item.input_audio_transcription.completed": {
          const transcript = event.transcript?.trim();
          setLiveUser("");

          if (transcript) {
            onMessage(createMessage("user", transcript, { inputType: "voice" }));

            /* Nothing is spoken until this resolves. */
            setStatus("thinking");
            void moderateThenRespond(transcript);
          }
          break;
        }

        case "response.output_audio.delta":
        case "response.audio.delta":
          setStatus("speaking");

          if (event.item_id && speakingItemRef.current?.id !== event.item_id) {
            /* First audio for this item: playback clock starts here. */
            speakingItemRef.current = {
              id: event.item_id,
              startedAt: Date.now(),
            };
          }
          break;

        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          setStatus("speaking");
          setLivePriya((current) => current + (event.delta ?? ""));
          break;

        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done": {
          const transcript = event.transcript?.trim();

          if (transcript) {
            onMessage(
              createMessage("assistant", transcript, {
                outputType: "voice",
                interrupted: interruptedRef.current,
              }),
            );
          }

          interruptedRef.current = false;
          setLivePriya("");
          break;
        }

        case "response.done":
          speakingItemRef.current = null;
          setStatus((current) =>
            current === "speaking" || current === "thinking"
              ? "listening"
              : current,
          );

          /* Not during a disclosure — that is not a moment to ask about storage. */
          if (!isActiveSafetyPhase(phaseRef.current)) {
            void requestMemoryProposal();
          }
          break;

        case "error": {
          const detail = `${event.error?.code ?? ""} ${event.error?.type ?? ""} ${event.error?.message ?? ""}`;

          if (BENIGN_ERROR_PATTERN.test(detail)) {
            /* Expected during barge-in. Not a connection failure. */
            console.debug("Realtime benign error:", detail.trim());
            break;
          }

          console.error("Realtime error:", detail.trim());
          setError("The voice connection reported an error.");
          setStatus("error");
          break;
        }
      }
    },
    [moderateThenRespond, onMessage, requestMemoryProposal, truncateSpokenTurn],
  );

  /**
   * Replays the existing conversation into the fresh session, so switching
   * from text to voice continues rather than starting over. The greeting is
   * skipped; it is scaffolding, not something anyone said.
   */
  const seedHistory = useCallback(() => {
    historyRef.current
      .filter((message) => message.id !== "priya-greeting")
      .slice(-40)
      .forEach((message) => {
        send({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: message.role,
            content: [
              {
                type:
                  message.role === "user" ? "input_text" : "output_text",
                text: message.content,
              },
            ],
          },
        });
      });
  }, [send]);

  async function connect() {
    setError("");
    setSafetyWarning("");
    setStatus("connecting");

    let micStream: MediaStream;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (caught) {
      const name = caught instanceof DOMException ? caught.name : "";

      setError(
        name === "NotAllowedError"
          ? "Microphone permission was denied. You can allow it in your browser settings, or keep going by text."
          : name === "NotFoundError"
            ? "No microphone was found. You can still talk to PRIYA by text."
            : "The microphone couldn’t be opened. You can still talk to PRIYA by text.",
      );
      setStatus("error");
      return;
    }

    micStreamRef.current = micStream;

    try {
      const sessionResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          memories,
          preferences,
          safetyPhase,
          recalled,
        }),
      });

      if (!sessionResponse.ok) {
        throw new Error(
          sessionResponse.status === 429
            ? "Too many voice sessions started. Please wait a moment."
            : "Could not start a voice session.",
        );
      }

      const { clientSecret, model } = (await sessionResponse.json()) as {
        clientSecret: string;
        model: string;
      };

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      peer.ontrack = (trackEvent) => {
        if (audioRef.current) {
          audioRef.current.srcObject = trackEvent.streams[0];
        }
      };

      peer.onconnectionstatechange = () => {
        if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        ) {
          setError("The connection dropped. Check your network and try again.");
          setStatus("error");
        }
      };

      micStream.getTracks().forEach((track) => peer.addTrack(track, micStream));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;

      channel.onopen = () => {
        seedHistory();
        setStatus("listening");
      };

      channel.onmessage = (message) => {
        try {
          handleEvent(JSON.parse(message.data));
        } catch {
          /* Non-JSON frames aren't interesting to us. */
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );

      if (!sdpResponse.ok) {
        throw new Error("The voice service refused the connection.");
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (caught) {
      micStream.getTracks().forEach((track) => track.stop());
      setError(
        caught instanceof Error
          ? caught.message
          : "The voice session couldn’t start.",
      );
      setStatus("error");
    }
  }

  function toggleMute() {
    const stream = micStreamRef.current;

    if (!stream) {
      return;
    }

    const nextMuted = !isMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
  }

  const isLive = status !== "idle" && status !== "error";

  return (
    <div className="space-y-4">
      <audio ref={audioRef} autoPlay className="hidden" />

      <div className="flex flex-col items-center gap-4 rounded-3xl border border-stone-200 bg-stone-50 p-8">
        <StatusOrb status={status} />

        <p
          className="text-sm font-medium text-stone-700"
          aria-live="polite"
          role="status"
        >
          {STATUS_COPY[status]}
        </p>

        <p className="text-xs text-stone-500">
          {isLive && !isMuted
            ? "Your microphone is on."
            : isMuted
              ? "Your microphone is muted."
              : "Your microphone is off."}
        </p>

        <div className="flex flex-wrap justify-center gap-2">
          {!isLive ? (
            <button
              type="button"
              onClick={connect}
              className="rounded-2xl bg-stone-900 px-5 py-2.5 font-medium text-white"
            >
              Talk to PRIYA
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className="rounded-2xl border border-stone-300 bg-white px-5 py-2.5 font-medium"
              >
                {isMuted ? "Unmute" : "Mute"}
              </button>

              <button
                type="button"
                onClick={disconnect}
                className="rounded-2xl bg-red-700 px-5 py-2.5 font-medium text-white"
              >
                End conversation
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              disconnect();
              onSwitchToText();
            }}
            className="rounded-2xl border border-stone-300 bg-white px-5 py-2.5 font-medium"
          >
            Switch to text
          </button>
        </div>
      </div>

      {(liveUser || livePriya) && (
        <div className="space-y-2 rounded-2xl border border-stone-200 p-4 text-sm">
          {liveUser && (
            <p className="text-stone-600">
              <span className="font-medium">You: </span>
              {liveUser}
            </p>
          )}
          {livePriya && (
            <p className="text-stone-900">
              <span className="font-medium">PRIYA: </span>
              {livePriya}
            </p>
          )}
        </div>
      )}

      {safetyWarning && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {safetyWarning}
        </p>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
    </div>
  );
}

function StatusOrb({ status }: { status: VoiceStatus }) {
  const tone =
    status === "speaking"
      ? "bg-stone-900 animate-pulse"
      : status === "listening"
        ? "bg-emerald-600"
        : status === "thinking"
          ? "bg-amber-500 animate-pulse"
          : status === "connecting"
            ? "bg-stone-400 animate-pulse"
            : status === "error"
              ? "bg-red-600"
              : "bg-stone-300";

  return (
    <div
      aria-hidden
      className={`h-20 w-20 rounded-full transition-colors ${tone}`}
    />
  );
}
