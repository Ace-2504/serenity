import { prisma } from "@/lib/prisma";
import { enqueueJob } from "@/server/jobs/queue";
import { kickJobs } from "@/server/jobs/runner";

/** The business the website is linked to, if any. The only cross-business read: by kind. */
export const linkedWebsiteSource = () => prisma.dataSource.findFirst({ where: { kind: "storefront" }, select: { id: true, tenantId: true } });

/**
 * Queues a sync after something changed on the website (an order, stock, a purchase). A sync that
 * is already running may have read the website before this change, so only a queued one absorbs it.
 * Never throws.
 */
export async function queueWebsiteSync(reason: string): Promise<void> {
  try {
    const source = await linkedWebsiteSource();
    if (!source) return;
    await enqueueJob(source.tenantId, "website.sync", { dataSourceId: source.id, reason }, { dedupeKey: `website.sync:${source.id}`, queuedOnly: true });
    kickJobs();
  } catch (error) {
    console.error("could not queue the website sync", error);
  }
}
