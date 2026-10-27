import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_DECIDE } from "@/server/bi/context";
import { markSending } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";

/** The owner's explicit send action. Requires every approval; sending runs as a background job. */
export async function POST(request: NextRequest, { params }: { params: { campaignId: string } }) {
  const bi = await requireBi(request, CAN_DECIDE);
  if (bi instanceof NextResponse) return bi;
  if (!(await bi.db.campaign.findFirst({ where: { id: params.campaignId }, select: { id: true } }))) return jsonError(404, "NOT_FOUND", "Campaign not found");
  try {
    await markSending(bi.db, bi.tenant.id, bi.userId, params.campaignId);
  } catch (error) {
    if (error instanceof WorkflowError) return jsonError(409, "INVALID_TRANSITION", error.message);
    throw error;
  }
  const job = await enqueueJob(bi.tenant.id, "campaign.send", { campaignId: params.campaignId }, { createdBy: bi.userId, dedupeKey: `campaign.send:${params.campaignId}` });
  kickJobs();
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
