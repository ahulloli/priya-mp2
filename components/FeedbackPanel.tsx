"use client";

import { useState } from "react";

type Props = {
  /** How many feedback entries already exist for this conversation. */
  submittedCount: number;
  onSubmit: (entry: {
    feltUnderstood: number;
    helpful: number;
    hasNextStep: boolean;
    comments?: string;
  }) => void;
};

const SCALE = [1, 2, 3, 4, 5];

/**
 * The metric that matters: the share of conversations where someone felt
 * understood and left with a realistic next step. Not length, not streaks.
 */
export default function FeedbackPanel({ submittedCount, onSubmit }: Props) {
  const [feltUnderstood, setFeltUnderstood] = useState<number | null>(null);
  const [helpful, setHelpful] = useState<number | null>(null);
  const [hasNextStep, setHasNextStep] = useState<boolean | null>(null);
  const [comments, setComments] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);

  const complete =
    feltUnderstood !== null && helpful !== null && hasNextStep !== null;

  if (justSubmitted) {
    return (
      <section className="rounded-2xl border border-stone-200 p-5">
        <p className="text-sm text-stone-600">
          Thank you — that’s saved.{" "}
          <button
            type="button"
            onClick={() => setJustSubmitted(false)}
            className="underline"
          >
            Leave more feedback
          </button>
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-stone-200 p-5">
      <div>
        <h2 className="font-semibold">How did that go?</h2>
        {submittedCount > 0 && (
          <p className="mt-1 text-xs text-stone-500">
            {submittedCount} previous response
            {submittedCount === 1 ? "" : "s"} saved.
          </p>
        )}
      </div>

      <Scale
        label="Did you feel understood?"
        value={feltUnderstood}
        onChange={setFeltUnderstood}
      />

      <Scale
        label="Was the conversation helpful?"
        value={helpful}
        onChange={setHelpful}
      />

      <fieldset>
        <legend className="text-sm font-medium">
          Do you have a next step?
        </legend>
        <div className="mt-2 flex gap-2">
          {[
            { label: "Yes", value: true },
            { label: "No", value: false },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setHasNextStep(option.value)}
              className={`rounded-xl border px-4 py-1.5 text-sm ${
                hasNextStep === option.value
                  ? "border-stone-900 bg-stone-900 text-white"
                  : "border-stone-300"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm">
        <span className="font-medium">What could PRIYA improve?</span>
        <textarea
          value={comments}
          onChange={(event) => setComments(event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Optional"
          className="mt-1 w-full rounded-xl border border-stone-300 p-3"
        />
      </label>

      <button
        type="button"
        disabled={!complete}
        onClick={() => {
          onSubmit({
            feltUnderstood: feltUnderstood!,
            helpful: helpful!,
            hasNextStep: hasNextStep!,
            comments: comments.trim() || undefined,
          });
          setFeltUnderstood(null);
          setHelpful(null);
          setHasNextStep(null);
          setComments("");
          setJustSubmitted(true);
        }}
        className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Send feedback
      </button>
    </section>
  );
}

function Scale({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-2 flex gap-2">
        {SCALE.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`h-9 w-9 rounded-xl border text-sm ${
              value === option
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
