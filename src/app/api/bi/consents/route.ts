import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const body = z.object({
  partyId: z.string().uuid(),
  channel: z.enum(["email", "whatsapp", "sms"]),
  status: z.enum(["granted", "revoked"]),
  source: z.string().trim().min(3).max(200),
  evidence: z.string().trim().max(1000).optional()
});

/** Record that a customer agreed to (or refused) messages on a channel, and how that was obtained. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Give the customer, channel, status and how consent was obtained");
  const party = await bi.db.party.findFirst({ where: { id: parsed.data.partyId }, select: { id: true } });
  if (!party) return jsonError(404, "NOT_FOUND", "Customer not found");
  const consent = await bi.db.contactConsent.create({ data: { tenantId: bi.tenant.id, ...parsed.data, recordedBy: bi.userId } });
  await bi.db.auditLog.create({ data: { tenantId: bi.tenant.id, actorUserId: bi.userId, action: `consent.${parsed.data.status}`, entity: "Party", entityId: party.id, after: { channel: parsed.data.channel, source: parsed.data.source } } });
  return NextResponse.json({ id: consent.id }, { status: 201 });
}
