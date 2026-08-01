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
  /* Once a disclosure happens, later turns stay in follow-up. */
  const highRiskRef = useRef(false);

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

  /**
   * The gate. The session is configured with create_response: false, so
   * nothing is spoken until this runs and explicitly asks for a response.
   * Every path through here either creates a response or leaves the turn
   * unanswered — never both, and never before the verdict.
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
        /*
         * Failing open would mean speaking without ever having checked. The
         * turn goes unanswered and the user is told why.
         */
        setSafetyWarning(
          "PRIYA couldn’t run her safety check, so she didn’t reply to that. Please try again, or switch to text.",
        );
        setStatus("listening");
        return;
      }

      onSafetyState(safetyState);

      if (safetyState === "high_risk") {
        highRiskRef.current = true;

        /* Swap in crisis handling before asking for any audio. */
        send({
          type: "session.update",
          session: { type: "realtime", instructions: CRISIS_TURN },
        });
      } else if (highRiskRef.current) {
        /* Still inside the follow-up: keep the crisis framing in place. */
        send({
          type: "session.update",
          session: { type: "realtime", instructions: FOLLOW_UP_TURN },
        });
      }

      send({ type: "response.create" });
    },
    [onSafetyState, send],
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

            /* Nothing is spoken until this resolves. */
            setStatus("thinking");
            void moderateThenRespond(transcript);
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
    [moderateThenRespond, onMessage, stopSpeaking],
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

const FOLLOW_UP_TURN = `This is still the conversation that followed a disclosure about
self-harm. You've already named their safety and already pointed them toward
help, and the crisis numbers are on their screen — repeating them now makes
them feel processed rather than heard.

This is the part where you stay. Warm, ordinary, present. Listen to what
they're actually asking for; if they want reassurance rather than another
safety question, give it — for someone who feels alone that is most of the
work, not a detour from it.

Don't recite hotlines again, don't ask about plans or access to means, don't
treat a hesitant "I think so" as a reason to escalate, and don't narrate what
you're doing. One question at most, and often none is better. Stay honest that
you're an AI who can't be there in person. If they seem steadier and want to
talk about something else, go with them.`;

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
