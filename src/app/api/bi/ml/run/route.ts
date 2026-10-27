import { NextResponse, type NextRequest } from "next/server";
import { requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";

/** Retrains and re-tests the prediction models on the business's current data (background job). */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const job = await enqueueJob(bi.tenant.id, "ml.run", {}, { createdBy: bi.userId, dedupeKey: "ml.run" });
  kickJobs();
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
