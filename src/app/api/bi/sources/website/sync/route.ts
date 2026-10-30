import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

/** Re-reads the website into the books now (202 + jobId). Syncs also run after every order. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const source = await bi.db.dataSource.findFirst({ where: { kind: "storefront" } });
  if (!source) return jsonError(404, "NOT_FOUND", "Link the website to this business first");
  const job = await enqueueJob(bi.tenant.id, "website.sync", { dataSourceId: source.id, userId: bi.userId }, { createdBy: bi.userId, dedupeKey: `website.sync:${source.id}` });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
