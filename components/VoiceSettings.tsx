"use client";

import type { VoicePreferences } from "@/types/chat";
import { REALTIME_VOICES } from "@/types/chat";

type Props = {
  preferences: VoicePreferences;
  onChange: (preferences: VoicePreferences) => void;
  /** Preference edits only take effect on the next session. */
  disabled: boolean;
};

const CHOICES = {
  warmth: ["reserved", "balanced", "very_warm"],
  directness: ["gentle", "balanced", "direct"],
  energy: ["calm", "balanced", "upbeat"],
  responseLength: ["brief", "balanced", "thorough"],
} as const;

const LABELS: Record<string, string> = {
  reserved: "Reserved",
  balanced: "Balanced",
  very_warm: "Very warm",
  gentle: "Gentle",
  direct: "Direct",
  calm: "Calm",
  upbeat: "Upbeat",
  brief: "Brief",
  thorough: "Thorough",
};

export default function VoiceSettings({
  preferences,
  onChange,
  disabled,
}: Props) {
  function update<K extends keyof VoicePreferences>(
    key: K,
    value: VoicePreferences[K],
  ) {
    onChange({ ...preferences, [key]: value });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 p-5">
      <div>
        <h2 className="font-semibold">How PRIYA sounds</h2>
        <p className="mt-1 text-sm text-stone-600">
          These change delivery only. They don’t change what PRIYA will or won’t
          say.
          {disabled && " Changes apply to your next conversation."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium">Voice</span>
          <select
            value={preferences.voice}
            onChange={(event) =>
              update("voice", event.target.value as VoicePreferences["voice"])
            }
            className="mt-1 w-full rounded-xl border border-stone-300 p-2 capitalize"
          >
            {REALTIME_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="font-medium">
            Speaking pace ({preferences.pace.toFixed(2)}×)
          </span>
          <input
            type="range"
            min={0.7}
            max={1.2}
            step={0.05}
            value={preferences.pace}
            onChange={(event) =>
              update("pace", Number(event.target.value))
            }
            className="mt-2 w-full"
          />
        </label>

        {(
          Object.keys(CHOICES) as Array<keyof typeof CHOICES>
        ).map((key) => (
          <label key={key} className="block text-sm">
            <span className="font-medium capitalize">
              {key === "responseLength" ? "Response length" : key}
            </span>
            <select
              value={preferences[key]}
              onChange={(event) =>
                update(
                  key,
                  event.target
                    .value as VoicePreferences[typeof key],
                )
              }
              className="mt-1 w-full rounded-xl border border-stone-300 p-2"
            >
              {CHOICES[key].map((choice) => (
                <option key={choice} value={choice}>
                  {LABELS[choice]}
                </option>
              ))}
            </select>
          </label>
        ))}

        <label className="block text-sm">
          <span className="font-medium">
            Pause before PRIYA replies ({preferences.silenceMs} ms)
          </span>
          <input
            type="range"
            min={200}
            max={3000}
            step={100}
            value={preferences.silenceMs}
            onChange={(event) =>
              update("silenceMs", Number(event.target.value))
            }
            className="mt-2 w-full"
          />
        </label>

        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={preferences.useName}
              onChange={(event) => update("useName", event.target.checked)}
            />
            <span className="font-medium">Use my name</span>
          </label>

          {preferences.useName && (
            <input
              type="text"
              value={preferences.name ?? ""}
              onChange={(event) => update("name", event.target.value)}
              placeholder="What should PRIYA call you?"
              maxLength={80}
              className="w-full rounded-xl border border-stone-300 p-2"
            />
          )}
        </div>
      </div>
    </section>
  );
}
