import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireSignedIn, withActiveTenant } from "@/server/bi/api";
import { createDemoTenant, DEMO_PACKS, fullDemoAllowed } from "@/server/bi/demo";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

const body = z.object({ size: z.enum(["quick", "full"]).default("quick"), pack: z.enum(DEMO_PACKS).default("stationery") });

/** Creates the demo business now and loads its data as a background job (202 + jobId). */
export async function POST(request: NextRequest) {
  const owner = await requireSignedIn(request);
  if (owner instanceof NextResponse) return owner;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "size must be quick or full, pack stationery or pharmacy");
  if (parsed.data.size === "full" && !fullDemoAllowed()) return jsonError(400, "NOT_AVAILABLE", "The two-year demo needs the background worker, which this server does not run");
  const limited = LIMITS.demosPerUser.take(owner.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many demo loads; try again later");
  const tenant = await createDemoTenant(owner.userId, parsed.data.size, parsed.data.pack);
  const job = await enqueueJob(tenant.id, "demo.load", { size: parsed.data.size, userId: owner.userId }, { createdBy: owner.userId });
  kickJobs();
  return withActiveTenant(NextResponse.json({ tenantId: tenant.id, jobId: job.id }, { status: 202 }), tenant.id);
}
