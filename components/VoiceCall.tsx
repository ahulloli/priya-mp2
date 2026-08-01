"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ChatMessage,
  PriyaMode,
  SafetyState,
  VoicePreferences,
} from "@/types/chat";

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
  preferences: VoicePreferences;
  /** Called for every finished turn so it lands in the shared conversation. */
  onMessage: (message: ChatMessage) => void;
  onSafetyState: (state: SafetyState) => void;
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

export default function VoiceCall({
  mode,
  memories,
  preferences,
  onMessage,
  onSafetyState,
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
  /* Tracks whether the current PRIYA turn was cut off by the user. */
  const interruptedRef = useRef(false);

  const send = useCallback((event: Record<string, unknown>) => {
    const channel = channelRef.current;

    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(event));
    }
  }, []);

  /** Cuts PRIYA off immediately — both the generation and the audio already buffered. */
  const stopSpeaking = useCallback(() => {
    send({ type: "response.cancel" });

    const audio = audioRef.current;

    if (audio) {
      /*
       * Cancelling generation doesn't drop audio already in the jitter buffer,
       * so the element gets reset too. Otherwise PRIYA keeps talking for a
       * second after being interrupted.
       */
      const stream = audio.srcObject;
      audio.srcObject = null;
      audio.srcObject = stream;
    }
  }, [send]);

  const checkSafety = useCallback(
    async (text: string) => {
      try {
        const response = await fetch("/api/moderate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!response.ok) {
          setSafetyWarning(
            "The safety check is unavailable right now, so this conversation isn’t being screened.",
          );
          return;
        }

        const data = (await response.json()) as { safetyState: SafetyState };

        onSafetyState(data.safetyState);

        if (data.safetyState === "high_risk") {
          /*
           * The audio connection is direct, so this verdict lands after PRIYA
           * has already started answering. Cut her off and hand the turn to
           * the crisis panel the parent renders.
           */
          stopSpeaking();
          send({
            type: "session.update",
            session: { type: "realtime", instructions: CRISIS_TURN },
          });
        }
      } catch {
        setSafetyWarning(
          "The safety check couldn’t run. Please switch to text if this is a hard conversation.",
        );
      }
    },
    [onSafetyState, send, stopSpeaking],
  );

  const disconnect = useCallback(() => {
    peerRef.current?.getSenders().forEach((sender) => sender.track?.stop());
    peerRef.current?.close();
    peerRef.current = null;

    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;

    channelRef.current = null;
    setStatus("idle");
    setLiveUser("");
    setLivePriya("");
  }, []);

  /* A live mic must never outlive the component. */
  useEffect(() => disconnect, [disconnect]);

  const handleEvent = useCallback(
    (event: { type: string; transcript?: string; delta?: string }) => {
      switch (event.type) {
        case "input_audio_buffer.speech_started":
          /* They started talking. If PRIYA was mid-sentence, that's an interrupt. */
          setStatus((current) => {
            if (current === "speaking") {
              interruptedRef.current = true;
              stopSpeaking();
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
            onMessage({
              id: crypto.randomUUID(),
              role: "user",
              content: transcript,
              input_type: "voice",
              createdAt: new Date().toISOString(),
            });

            void checkSafety(transcript);
          }
          break;
        }

        case "response.output_audio.delta":
        case "response.audio.delta":
          setStatus("speaking");
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
            onMessage({
              id: crypto.randomUUID(),
              role: "assistant",
              content: transcript,
              output_type: "voice",
              interrupted: interruptedRef.current || undefined,
              createdAt: new Date().toISOString(),
            });
          }

          interruptedRef.current = false;
          setLivePriya("");
          break;
        }

        case "response.done":
          setStatus((current) =>
            current === "speaking" || current === "thinking"
              ? "listening"
              : current,
          );
          break;

        case "error":
          setError("The voice connection reported an error.");
          setStatus("error");
          break;
      }
    },
    [checkSafety, onMessage, stopSpeaking],
  );

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
        body: JSON.stringify({ mode, memories, preferences }),
      });

      if (!sessionResponse.ok) {
        throw new Error("Could not start a voice session.");
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

      channel.onopen = () => setStatus("listening");
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

const CRISIS_TURN = `Their last message signalled they may be at risk of hurting themselves.
Stop the ordinary conversation. Say plainly that their safety matters more than
continuing, ask whether they are in immediate danger right now, and encourage
them to reach someone who can be physically with them or a local crisis line.
Be clear you are not an emergency service and cannot send anyone. Stay warm.`;

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
