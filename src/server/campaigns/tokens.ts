import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Unsubscribe tokens: tenant, party and channel, signed with the app secret so a link cannot be
 * forged to unsubscribe someone else. They do not expire: an old email must still unsubscribe.
 */

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET is required");
  return s ?? "dev-only-secret";
}

const sign = (payload: string) => createHmac("sha256", secret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 22);

export function unsubscribeToken(tenantId: string, partyId: string, channel: string): string {
  const payload = Buffer.from(`${tenantId}.${partyId}.${channel}`).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readUnsubscribeToken(token: string): { tenantId: string; partyId: string; channel: string } | null {
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [tenantId, partyId, channel] = Buffer.from(payload, "base64url").toString().split(".");
  return tenantId && partyId && channel ? { tenantId, partyId, channel } : null;
}

/** Deterministic holdout: the same campaign always puts the same customers in the control group. */
export function inHoldout(campaignId: string, partyId: string, pct: number): boolean {
  const h = createHmac("sha256", "holdout").update(`${campaignId}:${partyId}`).digest().readUInt32BE(0);
  return h / 0xffffffff < pct / 100;
}
