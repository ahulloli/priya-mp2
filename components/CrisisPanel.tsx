import { CRISIS_RESOURCES, NOT_AN_EMERGENCY_SERVICE } from "@/lib/safety";

/**
 * Shown on screen whenever the conversation is in the high-risk state, in text
 * and in voice alike. Someone who only heard a number read aloud once will not
 * have retained it.
 */
export default function CrisisPanel({
  onHide,
  onResolve,
}: {
  /** Collapses the panel. Deliberately does not change the safety phase. */
  onHide: () => void;
  /** The user saying they're okay — the only thing that ends the phase. */
  onResolve: () => void;
}) {
  return (
    <section
      role="alert"
      className="space-y-3 rounded-2xl border-2 border-red-300 bg-red-50 p-5"
    >
      <h2 className="text-lg font-semibold text-red-900">
        Please reach someone who can be with you
      </h2>

      <ul className="space-y-2">
        {CRISIS_RESOURCES.map((resource) => (
          <li key={`${resource.region}-${resource.label}`} className="text-sm">
            <span className="font-medium text-red-900">{resource.label}</span>
            <span className="text-red-800"> — {resource.contact}</span>
            <span className="block text-xs text-red-700">
              {resource.region}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-red-800">{NOT_AN_EMERGENCY_SERVICE}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResolve}
          className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900"
        >
          I’m safe now
        </button>

        <button
          type="button"
          onClick={onHide}
          className="rounded-xl px-4 py-2 text-sm text-red-800 underline"
        >
          Hide this
        </button>
      </div>
    </section>
  );
}
