import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_DECIDE } from "@/server/bi/context";
import { cancelCampaign } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { campaignId: string } }) {
  const bi = await requireBi(request, CAN_DECIDE);
  if (bi instanceof NextResponse) return bi;
  if (!(await bi.db.campaign.findFirst({ where: { id: params.campaignId }, select: { id: true } }))) return jsonError(404, "NOT_FOUND", "Campaign not found");
  try {
    const c = await cancelCampaign(bi.db, bi.tenant.id, bi.userId, params.campaignId);
    return NextResponse.json({ id: c.id, status: c.status });
  } catch (error) {
    if (error instanceof WorkflowError) return jsonError(409, "INVALID_TRANSITION", error.message);
    throw error;
  }
}
