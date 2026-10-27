import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, parseSessionToken, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

const user = { userId: "u1", email: "owner@example.com", roles: ["owner_admin" as const] };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("round-trips a fresh token", () => {
    const token = createSessionToken(user);
    expect(parseSessionToken(token)).toMatchObject(user);
  });

  it("rejects a tampered payload", () => {
    const [body, signature] = createSessionToken(user).split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), roles: ["owner_admin", "catalog_manager"] })
    ).toString("base64url");
    expect(parseSessionToken(`${forged}.${signature}`)).toBeNull();
  });

  it("rejects a truncated signature without throwing", () => {
    const token = createSessionToken(user);
    expect(parseSessionToken(token.slice(0, -5))).toBeNull();
  });

  it("rejects a token older than the session lifetime", () => {
    const token = createSessionToken(user);
    const later = Date.now() + SESSION_MAX_AGE_SECONDS * 1000 + 1;
    expect(parseSessionToken(token, later)).toBeNull();
  });

  it("rejects a token issued in the future", () => {
    const token = createSessionToken(user);
    expect(parseSessionToken(token, Date.now() - 60_000)).toBeNull();
  });

  it("refuses to sign with the development fallback secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => createSessionToken(user)).toThrow(/AUTH_SECRET/);
  });
});
