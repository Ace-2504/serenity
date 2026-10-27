import { NextResponse, type NextRequest } from "next/server";
import { readUnsubscribeToken } from "@/server/campaigns/tokens";
import { forTenant } from "@/server/db/tenant";
import { clientIp, LIMITS, takeForIp, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058 style POST). Public: the signed token identifies the business,
 * customer and channel. Always records a revocation; never reveals anything about the customer.
 */
export async function POST(request: NextRequest) {
  const limited = takeForIp(LIMITS.unsubscribePerIp, clientIp(request));
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
  const form = await request.formData().catch(() => null);
  const token = (form?.get("token") as string | null) ?? request.nextUrl.searchParams.get("token") ?? "";
  const parsed = readUnsubscribeToken(token);
  if (!parsed) return NextResponse.json({ ok: false }, { status: 400 });
  const db = forTenant(parsed.tenantId);
  const party = await db.party.findFirst({ where: { id: parsed.partyId }, select: { id: true } });
  if (party) {
    await db.contactConsent.create({ data: { tenantId: parsed.tenantId, partyId: party.id, channel: parsed.channel, status: "revoked", source: "unsubscribe link" } });
  }
  // A browser form gets a confirmation page; a mail client's one-click POST gets JSON.
  if (form && (request.headers.get("accept") ?? "").includes("text/html")) {
    return NextResponse.redirect(new URL(`/u/${encodeURIComponent(token)}?done=1`, request.url), 303);
  }
  return NextResponse.json({ ok: true });
}
