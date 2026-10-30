import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_DECIDE } from "@/server/bi/context";
import { approveStep } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";

export const dynamic = "force-dynamic";

const body = z.object({ step: z.enum(["audience", "content", "offer", "send"]) });

/** Owner approval of one step, in order. Only the business owner can approve. */
export async function POST(request: NextRequest, { params }: { params: { campaignId: string } }) {
  const bi = await requireBi(request, CAN_DECIDE);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "step must be audience, content, offer or send");
  if (!(await bi.db.campaign.findFirst({ where: { id: params.campaignId }, select: { id: true } }))) return jsonError(404, "NOT_FOUND", "Campaign not found");
  try {
    const c = await approveStep(bi.db, bi.tenant.id, bi.userId, params.campaignId, parsed.data.step);
    return NextResponse.json({ id: c.id, status: c.status });
  } catch (error) {
    if (error instanceof WorkflowError) return jsonError(409, "INVALID_TRANSITION", error.message);
    throw error;
  }
}
