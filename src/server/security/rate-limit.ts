import { NextResponse, type NextRequest } from "next/server";

/**
 * Fixed-window rate limits held in this process's memory. Enough for one app server (the Docker
 * Compose setup); several servers behind a load balancer would each apply the limit separately.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(readonly limit: number, readonly windowMs: number, private readonly maxKeys = 10_000) {}

  /** Counts one attempt for `key`; returns how long to wait if the limit is already reached. */
  take(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      if (!w && this.windows.size >= this.maxKeys) this.prune(now);
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.start + this.windowMs - now) / 1000)) };
    w.count += 1;
    return { ok: true };
  }

  private prune(now: number) {
    for (const [key, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(key);
    // Still full of live windows: drop the oldest rather than grow without bound.
    while (this.windows.size >= this.maxKeys) this.windows.delete(this.windows.keys().next().value as string);
  }
}

/**
 * The client's address, or null when unknown. Forwarded headers can be forged, so they are used
 * only when the operator says a reverse proxy sets them (TRUST_PROXY=1). Without an address,
 * per-address limits are skipped: one shared key would let anyone lock everyone out.
 */
export function clientIp(request: NextRequest): string | null {
  if (process.env.TRUST_PROXY !== "1") return null;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || null;
}

/** Counts an attempt against a per-address limit when the address is known. */
export const takeForIp = (limiter: RateLimiter, ip: string | null) => (ip ? limiter.take(ip) : ({ ok: true } as const));

/** A same-site path to return to after sign-in; anything else (another site, "//host") becomes "/". */
export const safeNextPath = (value: string) => (/^\/(?![/\\])/.test(value) ? value : "/");

export function tooManyRequests(retryAfterSec: number, message = "Too many requests; try again later") {
  return NextResponse.json({ code: "RATE_LIMITED", message }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });
}

const MINUTE = 60_000;

/** The limits in use, in one place so the operations guide can list them. */
export const LIMITS = {
  loginPerEmail: new RateLimiter(10, 15 * MINUTE),
  loginPerIp: new RateLimiter(50, 15 * MINUTE),
  registerPerIp: new RateLimiter(10, 60 * MINUTE),
  importsPerUser: new RateLimiter(30, 60 * MINUTE),
  assistantPerUser: new RateLimiter(20, MINUTE),
  draftsPerUser: new RateLimiter(20, MINUTE),
  tallyTestsPerUser: new RateLimiter(20, MINUTE),
  unsubscribePerIp: new RateLimiter(60, MINUTE)
};
