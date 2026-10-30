import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { claimJob, enqueueJob, failJob, MAX_ATTEMPTS, requeueStale, STALE_AFTER_MINUTES } from "@/server/jobs/queue";
import { drainJobs } from "@/server/jobs/runner";

let tenantId: string;

beforeAll(async () => {
  // Isolate from jobs other tests may leave behind.
  await prisma.job.deleteMany({});
  tenantId = (await prisma.tenant.create({ data: { name: "Queue test", domainPack: "stationery", isDemo: true } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("Postgres job queue", () => {
  it("never hands the same job to two workers", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) ids.add((await enqueueJob(tenantId, "findings.refresh", { i })).id);
    const claims = await Promise.all(Array.from({ length: 30 }, (_, i) => claimJob(`w${i}`)));
    const claimed = claims.filter((j) => j !== null).map((j) => j!.id);
    expect(claimed.length).toBe(20);
    expect(new Set(claimed).size).toBe(20);
    expect(new Set(claimed)).toEqual(ids);
    await prisma.job.deleteMany({ where: { tenantId } });
  });

  it("returns the queued job instead of enqueueing a duplicate", async () => {
    const a = await enqueueJob(tenantId, "import.commit", { batchId: "b1" }, { dedupeKey: "commit:b1" });
    const b = await enqueueJob(tenantId, "import.commit", { batchId: "b1" }, { dedupeKey: "commit:b1" });
    expect(b.id).toBe(a.id);
    await prisma.job.deleteMany({ where: { tenantId } });
  });

  it("queues a fresh sync behind a running one, so a change made mid-sync is not lost", async () => {
    const first = await enqueueJob(tenantId, "website.sync", {}, { dedupeKey: "website.sync:s1", queuedOnly: true });
    expect((await claimJob("w"))!.id).toBe(first.id);
    const second = await enqueueJob(tenantId, "website.sync", {}, { dedupeKey: "website.sync:s1", queuedOnly: true });
    expect(second.id).not.toBe(first.id);
    const third = await enqueueJob(tenantId, "website.sync", {}, { dedupeKey: "website.sync:s1", queuedOnly: true });
    expect(third.id).toBe(second.id);
    await prisma.job.deleteMany({ where: { tenantId } });
  });

  it("retries transient failures with backoff, then gives up", async () => {
    await enqueueJob(tenantId, "findings.refresh", {});
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await prisma.job.updateMany({ where: { tenantId }, data: { runAfter: new Date(0) } });
      const job = (await claimJob("w"))!;
      expect(job.attempts).toBe(attempt);
      await failJob(job, "connection reset", true);
    }
    const job = await prisma.job.findFirstOrThrow({ where: { tenantId } });
    expect(job).toMatchObject({ status: "failed", error: "connection reset", attempts: MAX_ATTEMPTS });
    await prisma.job.deleteMany({ where: { tenantId } });
  });

  it("does not retry data errors", async () => {
    const job = await enqueueJob(tenantId, "import.commit", { batchId: "missing" });
    expect(await drainJobs("w")).toBe(1);
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("failed");
    expect(done.attempts).toBe(1);
    expect(done.error).toMatch(/^NOT_FOUND/);
    await prisma.job.deleteMany({ where: { tenantId } });
  });

  it("requeues a job whose worker died, and fails it after the last attempt", async () => {
    const job = await enqueueJob(tenantId, "findings.refresh", {});
    await claimJob("dead-worker");
    const later = new Date(Date.now() + (STALE_AFTER_MINUTES + 1) * 60_000);
    expect(await requeueStale(later)).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");

    await prisma.job.update({ where: { id: job.id }, data: { status: "running", attempts: MAX_ATTEMPTS, lockedAt: new Date() } });
    expect(await requeueStale(later)).toBe(1);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed");
  });

  it("runs a findings refresh end to end", async () => {
    const job = await enqueueJob(tenantId, "findings.refresh", {});
    expect(await drainJobs("w")).toBe(1);
    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("done");
    expect(done.result).toMatchObject({ outcomes: { measured: 0 } });
  });
});
