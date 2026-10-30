import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { amazonConfigured } from "@/server/adapters/marketplace/sp-api";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const body = z.object({ from: date, to: date }).refine((b) => b.from <= b.to, "from must not be after to");

/** Reads Amazon payouts for a period as a background job (202 + jobId); the result waits for review. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  if (bi.tenant.isDemo) return jsonError(409, "DEMO_BUSINESS", "Connect Amazon to your own business, not the demo");
  if (!amazonConfigured()) return jsonError(409, "NOT_CONFIGURED", "Amazon is not connected on this server (see the operations guide)");
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Give a period: from and to as YYYY-MM-DD");
  const job = await enqueueJob(bi.tenant.id, "amazon.sync", { ...parsed.data, userId: bi.userId }, { createdBy: bi.userId, dedupeKey: "amazon.sync" });
  kickJobs();
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
