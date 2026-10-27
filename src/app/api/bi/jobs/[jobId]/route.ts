import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

/** Job status for the caller's business. Polling also nudges the queue in case a run was interrupted. */
export async function GET(request: NextRequest, { params }: { params: { jobId: string } }) {
  const bi = await requireBi(request);
  if (bi instanceof NextResponse) return bi;
  const job = await bi.db.job.findFirst({
    where: { id: params.jobId },
    select: { id: true, type: true, status: true, progress: true, attempts: true, error: true, result: true, createdAt: true, finishedAt: true }
  });
  if (!job) return jsonError(404, "NOT_FOUND", "Job not found");
  if (job.status === "queued") kickJobs();
  return NextResponse.json(job);
}
