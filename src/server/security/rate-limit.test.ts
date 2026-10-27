import { describe, expect, it } from "vitest";
import { RateLimiter, safeNextPath } from "@/server/security/rate-limit";

describe("rate limiter", () => {
  it("allows the limit within a window, then refuses with the wait, then resets", () => {
    const limiter = new RateLimiter(3, 60_000);
    const results = [0, 1, 2, 3].map((i) => limiter.take("a", 1_000 + i));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({ ok: false, retryAfterSec: 60 });
    expect(limiter.take("b", 1_010).ok).toBe(true);
    expect(limiter.take("a", 61_000).ok).toBe(true);
  });

  it("stays bounded when many keys arrive", () => {
    const limiter = new RateLimiter(1, 60_000, 100);
    for (let i = 0; i < 1_000; i++) limiter.take(`k${i}`, 0);
    expect((limiter as unknown as { windows: Map<string, unknown> }).windows.size).toBeLessThanOrEqual(100);
  });
});

describe("return path after sign-in", () => {
  it("keeps same-site paths and drops anything that leaves the site", () => {
    expect(safeNextPath("/bi/campaigns?x=1")).toBe("/bi/campaigns?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", ""]) expect(safeNextPath(bad)).toBe("/");
  });
});
