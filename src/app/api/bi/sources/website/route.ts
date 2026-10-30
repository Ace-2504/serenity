import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { linkedWebsiteSource } from "@/server/adapters/website/queue";
import { WEBSITE_SOURCE_NAME } from "@/server/adapters/website/sync";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_DECIDE } from "@/server/bi/context";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

export const dynamic = "force-dynamic";
/** Background work started here runs within this limit on serverless hosts (see kickJobs). */
export const maxDuration = 60;

const body = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/**
 * Links this website to the owner's current business: from now on its orders, customers, stock and
 * purchase bills are the business's books for the website channel. One business only.
 */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_DECIDE);
  if (bi instanceof NextResponse) return bi;
  if (bi.tenant.isDemo) return jsonError(409, "DEMO_BUSINESS", "Link the website to your own business, not a demo");
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "The start date must be a date");
  const existing = await linkedWebsiteSource();
  if (existing && existing.tenantId !== bi.tenant.id) return jsonError(409, "ALREADY_LINKED", "The website is already linked to another business");
  const source =
    existing ??
    (await bi.db.dataSource.create({
      data: { tenantId: bi.tenant.id, kind: "storefront", name: WEBSITE_SOURCE_NAME, settings: { autoCommit: true, ...(parsed.data.from ? { from: parsed.data.from } : {}) } }
    }));
  const job = await enqueueJob(bi.tenant.id, "website.sync", { dataSourceId: source.id, userId: bi.userId }, { createdBy: bi.userId, dedupeKey: `website.sync:${source.id}` });
  kickJobs();
  return NextResponse.json({ dataSourceId: source.id, jobId: job.id }, { status: 202 });
}
