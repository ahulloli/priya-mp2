import { NextResponse } from "next/server";

/*
 * A blunt in-process limiter. It is enough to stop a stranger with a curl loop
 * draining the OpenAI budget on a single deployed instance, and it is NOT
 * enough for real multi-instance production: serverless spreads requests
 * across isolates, each with its own map, so the effective limit is the
 * configured one multiplied by however many instances are warm.
 *
 * Before a public launch this needs a shared store (Upstash/Redis) and real
 * per-user quotas keyed on an authenticated session rather than an IP.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/* Keeps the map from growing without bound on a long-lived server. */
function sweep(now: number): void {
  if (buckets.size < 5000) {
    return;
  }

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

export type RateLimit = { limit: number; windowMs: number };

/** Realtime tokens are the expensive ones, so they get the tightest budget. */
export const LIMITS = {
  chat: { limit: 30, windowMs: 60_000 },
  moderate: { limit: 120, windowMs: 60_000 },
  realtimeSession: { limit: 10, windowMs: 60_000 },
  title: { limit: 20, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");

  return (
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * Returns a 429 response when the caller is over budget, or null to proceed.
 */
export function checkRateLimit(
  request: Request,
  name: keyof typeof LIMITS,
): NextResponse | null {
  const { limit, windowMs } = LIMITS[name];
  const now = Date.now();
  const key = `${name}:${clientKey(request)}`;

  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  return null;
}

/**
 * Rejects cross-origin calls. Same-origin browser requests send Origin on
 * POST; anything from another site is refused. This is not a substitute for
 * authentication — it only raises the cost of casual abuse.
 */
export function checkOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");

  if (!origin) {
    /* curl and same-origin form posts omit it; nothing to check. */
    return null;
  }

  const allowed = [
    process.env.NEXT_PUBLIC_SITE_ORIGIN,
    request.headers.get("host") && `https://${request.headers.get("host")}`,
    request.headers.get("host") && `http://${request.headers.get("host")}`,
  ].filter(Boolean);

  if (!allowed.includes(origin)) {
    return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  }

  return null;
}

/** Both guards, in the order every OpenAI-backed route should apply them. */
export function guardRequest(
  request: Request,
  name: keyof typeof LIMITS,
): NextResponse | null {
  return checkOrigin(request) ?? checkRateLimit(request, name);
}
