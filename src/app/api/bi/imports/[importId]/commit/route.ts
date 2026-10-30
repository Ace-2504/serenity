import { NextResponse, type NextRequest } from "next/server";
import { CAN_IMPORT } from "@/server/bi/context";
import { jsonError, requireBi } from "@/server/bi/api";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

/** Queues the commit and returns at once (202); the client polls /api/bi/jobs/{jobId}. */
export async function POST(request: NextRequest, { params }: { params: { importId: string } }) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const batch = await bi.db.importBatch.findFirst({ where: { id: params.importId }, select: { id: true, status: true } });
  if (!batch) return jsonError(404, "NOT_FOUND", "Import not found");
  if (batch.status !== "validated") return jsonError(409, "NOT_COMMITTABLE", `This import is ${batch.status} and cannot be committed`);
  const job = await enqueueJob(bi.tenant.id, "import.commit", { batchId: batch.id, userId: bi.userId }, { createdBy: bi.userId, dedupeKey: `commit:${batch.id}` });
  kickJobs();
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
