import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";

/** Starts a sync from Tally as a background job (202 + jobId). */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const source = await bi.db.dataSource.findFirst({ where: { kind: "tally_http" } });
  if (!source) return jsonError(404, "NOT_FOUND", "Connect Tally first");
  const job = await enqueueJob(bi.tenant.id, "tally.sync", { dataSourceId: source.id, userId: bi.userId }, { createdBy: bi.userId, dedupeKey: `tally.sync:${source.id}` });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
