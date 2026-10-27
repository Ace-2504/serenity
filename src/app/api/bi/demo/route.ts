import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requirePlatformOwner, withActiveTenant } from "@/server/bi/api";
import { createDemoTenant } from "@/server/bi/demo";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";

const body = z.object({ size: z.enum(["quick", "full"]).default("quick") });

/** Creates the demo business now and loads its data as a background job (202 + jobId). */
export async function POST(request: NextRequest) {
  const owner = await requirePlatformOwner(request);
  if (owner instanceof NextResponse) return owner;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "size must be quick or full");
  const tenant = await createDemoTenant(owner.userId, parsed.data.size);
  const job = await enqueueJob(tenant.id, "demo.load", { size: parsed.data.size, userId: owner.userId }, { createdBy: owner.userId });
  kickJobs();
  return withActiveTenant(NextResponse.json({ tenantId: tenant.id, jobId: job.id }, { status: 202 }), tenant.id);
}
