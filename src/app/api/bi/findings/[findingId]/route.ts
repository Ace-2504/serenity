import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_DECIDE } from "@/server/bi/context";
import { actOnFinding, FindingActionError } from "@/server/findings/engine";

export const dynamic = "force-dynamic";

const body = z.object({ action: z.enum(["accept", "dismiss", "snooze", "reopen"]), note: z.string().max(2000).optional() });

/** Owner decision on a recommendation. Accountants and analysts can read findings but not decide. */
export async function POST(request: NextRequest, { params }: { params: { findingId: string } }) {
  const bi = await requireBi(request, CAN_DECIDE);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "action must be accept, dismiss, snooze or reopen");
  try {
    const finding = await actOnFinding(bi.db, bi.tenant.id, params.findingId, parsed.data.action, bi.userId, parsed.data.note);
    return NextResponse.json({ id: finding.id, status: finding.status, snoozedUntil: finding.snoozedUntil, measurePlan: finding.measurePlan });
  } catch (error) {
    if (error instanceof FindingActionError) return jsonError(error.message === "Finding not found" ? 404 : 409, "INVALID_TRANSITION", error.message);
    throw error;
  }
}
