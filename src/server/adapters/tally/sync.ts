import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fetchFromTally, TallyClient, TallyConnectionError } from "@/server/adapters/tally/live";
import type { TenantDb } from "@/server/db/tenant";
import { enqueueJob } from "@/server/jobs/queue";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

/**
 * A business's live TallyPrime source: where Tally listens, which company, and whether a sync
 * may save without review. A sync re-reads the whole period (books start to today) every time:
 * the safe default, because Tally does not signal deletions (07-integration-research.md).
 */

export const TALLY_SOURCE_NAME = "TallyPrime (live sync)";
export const tallySettingsSchema = z.object({
  url: z.string().trim().min(8).max(200),
  company: z.string().trim().min(1).max(200),
  /** Start of the period to read; default: the date the company's books begin. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Save a sync without review when it has no errors. */
  autoCommit: z.boolean().default(false),
  /** Sync once a day from the background worker (implies autoCommit). */
  dailySync: z.boolean().default(false)
});
export type TallySourceSettings = z.infer<typeof tallySettingsSchema>;

const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export type TallySyncResult = { batchId: string; status: string; committed: boolean; errors: number; warnings: number; from: string; to: string; requests: number };

export async function syncTally(
  db: TenantDb,
  tenantId: string,
  dataSourceId: string,
  options: { to?: string; userId?: string; onStep?: (step: string) => void; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {}
): Promise<TallySyncResult> {
  const source = await db.dataSource.findFirst({ where: { id: dataSourceId, kind: "tally_http" } });
  if (!source) throw new TallyConnectionError("This business has no live Tally connection");
  const settings = tallySettingsSchema.parse(source.settings ?? {});
  const client = new TallyClient(settings, { fetchImpl: options.fetchImpl, env: options.env });
  const fetched = await fetchFromTally(client, settings, { from: settings.from, to: options.to ?? indiaToday() }, options.onStep);

  options.onStep?.("stage");
  const staged = await stageImport(db, {
    tenantId,
    dataSourceId,
    files: fetched.conversion.files,
    userId: options.userId,
    adapter: {
      issues: fetched.conversion.issues,
      summary: {
        name: "TallyPrime live sync",
        verified: false,
        note: "Read from TallyPrime over its XML server. The connector is tested against a simulated Tally only, not yet a real TallyPrime: check the totals against Tally's registers before relying on them.",
        details: { ...fetched.conversion.summary, requests: fetched.requests, requestedPeriod: { from: fetched.from, to: fetched.to } }
      }
    }
  });
  const errors = staged.summary.issues.errors;
  let committed = false;
  if (staged.status === "validated" && errors === 0 && (settings.autoCommit || settings.dailySync)) {
    await commitImport(db, tenantId, staged.batchId, { userId: options.userId, onStep: options.onStep });
    committed = true;
  }
  if (staged.status === "duplicate") {
    // Nothing changed in Tally since the last saved sync.
    await db.dataSource.update({ where: { id: dataSourceId }, data: { lastSuccessfulSyncAt: new Date() } });
  }
  return { batchId: staged.batchId, status: staged.status, committed, errors, warnings: staged.summary.issues.warnings, from: fetched.from, to: fetched.to, requests: fetched.requests };
}

/**
 * Called by the background worker: queues a sync for every live Tally source set to sync daily
 * whose last successful sync is more than a day old. Runs across businesses, so it uses the raw
 * client and only reads ids; each sync then runs scoped to its own business.
 */
export async function enqueueDueTallySyncs(now = new Date()): Promise<number> {
  const due = await prisma.dataSource.findMany({
    where: {
      kind: "tally_http",
      settings: { path: ["dailySync"], equals: true },
      OR: [{ lastSuccessfulSyncAt: null }, { lastSuccessfulSyncAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } }]
    },
    select: { id: true, tenantId: true }
  });
  for (const s of due) await enqueueJob(s.tenantId, "tally.sync", { dataSourceId: s.id }, { dedupeKey: `tally.sync:${s.id}` });
  return due.length;
}
