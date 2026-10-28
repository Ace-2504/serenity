import { Prisma, type Job } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Postgres-backed job queue: no Redis at SME scale. Workers claim one job at a time with
 * FOR UPDATE SKIP LOCKED, so several workers (or the web process and a worker) never run the
 * same job twice. A job whose worker died is requeued once its lock is older than STALE_AFTER.
 */

export const MAX_ATTEMPTS = 3;
export const STALE_AFTER_MINUTES = 15;

export type JobType = "import.commit" | "demo.load" | "findings.refresh" | "ml.run" | "campaign.send" | "tally.sync" | "amazon.sync" | "website.sync";

/**
 * Enqueues a job, or returns the one already queued or running for the same key (e.g. the same
 * import). With queuedOnly, a running job does not count: use it when the job reads data that may
 * have changed since it started (a sync), so the change is picked up by the next run.
 */
export async function enqueueJob(
  tenantId: string,
  type: JobType,
  payload: Prisma.InputJsonObject,
  options: { createdBy?: string; dedupeKey?: string; queuedOnly?: boolean } = {}
): Promise<Job> {
  if (options.dedupeKey) {
    const existing = await prisma.job.findFirst({
      where: { tenantId, type, status: { in: options.queuedOnly ? ["queued"] : ["queued", "running"] }, payload: { path: ["dedupeKey"], equals: options.dedupeKey } }
    });
    if (existing) return existing;
  }
  return prisma.job.create({
    data: { tenantId, type, payload: { ...payload, ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}) }, createdBy: options.createdBy, progress: "Waiting to start" }
  });
}

/** Atomically claims the oldest runnable job. */
export async function claimJob(workerId: string): Promise<Job | null> {
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'running', "lockedAt" = now(), "lockedBy" = ${workerId}, "attempts" = "attempts" + 1, "progress" = 'Starting'
    WHERE "id" = (
      SELECT "id" FROM "Job" WHERE "status" = 'queued' AND "runAfter" <= now()
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING *`;
  return rows[0] ?? null;
}

export async function setProgress(jobId: string, progress: string) {
  await prisma.job.updateMany({ where: { id: jobId, status: "running" }, data: { progress, lockedAt: new Date() } }); // progress doubles as the heartbeat
}

export async function completeJob(jobId: string, result: Prisma.InputJsonValue) {
  await prisma.job.update({ where: { id: jobId }, data: { status: "done", result, progress: "Done", finishedAt: new Date(), lockedAt: null, lockedBy: null } });
}

/** Retries transient failures with backoff (30 s, 2 min); permanent failures and the last attempt fail the job. */
export async function failJob(job: Job, message: string, retryable: boolean) {
  const retry = retryable && job.attempts < MAX_ATTEMPTS;
  await prisma.job.update({
    where: { id: job.id },
    data: retry
      ? { status: "queued", error: message, runAfter: new Date(Date.now() + 30_000 * 4 ** (job.attempts - 1)), lockedAt: null, lockedBy: null, progress: "Will retry" }
      : { status: "failed", error: message, finishedAt: new Date(), lockedAt: null, lockedBy: null, progress: "Failed" }
  });
}

/** Requeues jobs whose worker stopped heartbeating (crash, deploy, frozen serverless function). */
export async function requeueStale(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000);
  const [requeued, failed] = await prisma.$transaction([
    prisma.job.updateMany({
      where: { status: "running", lockedAt: { lt: cutoff }, attempts: { lt: MAX_ATTEMPTS } },
      data: { status: "queued", lockedAt: null, lockedBy: null, progress: "Restarting after an interruption" }
    }),
    prisma.job.updateMany({
      where: { status: "running", lockedAt: { lt: cutoff }, attempts: { gte: MAX_ATTEMPTS } },
      data: { status: "failed", lockedAt: null, lockedBy: null, finishedAt: now, error: "Interrupted too many times", progress: "Failed" }
    })
  ]);
  return requeued.count + failed.count;
}
