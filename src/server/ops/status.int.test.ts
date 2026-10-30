import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { databaseHealth, systemStatus } from "@/server/ops/status";

/** The system page's numbers come from this business's own jobs and logs, and nobody else's. */

const ids: string[] = [];
const NOW = new Date("2026-10-27T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeAll(async () => {
  for (const name of ["Status A", "Status B"]) ids.push((await prisma.tenant.create({ data: { name, domainPack: "stationery" } })).id);
  const [a, b] = ids;
  const job = (tenantId: string, status: "done" | "failed" | "queued", createdMin: number, tookSec: number | null, error?: string) =>
    prisma.job.create({
      data: { tenantId, type: "ml.run", status, createdAt: ago(createdMin), finishedAt: tookSec === null ? null : new Date(ago(createdMin).getTime() + tookSec * 1000), error, attempts: 1 }
    });
  await job(a, "done", 60, 10);
  await job(a, "done", 50, 20);
  await job(a, "done", 40, 30);
  await job(a, "failed", 30, 5, "worker exited 1");
  await job(a, "queued", 2, null);
  await job(a, "done", 60 * 24 * 10, 999); // older than 7 days
  await job(b, "failed", 30, 5, "other business");
  const log = (tenantId: string, mode: string, guardOk: boolean | null, latencyMs: number) =>
    prisma.assistantLog.create({ data: { tenantId, question: "q", mode, guardOk, latencyMs, createdAt: ago(5) } });
  await log(a, "llm", true, 1000);
  await log(a, "template", false, 3000);
  await log(a, "template", null, 20);
  await log(b, "llm", false, 1);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("system status", () => {
  it("summarises this business's background work", async () => {
    const s = await systemStatus(forTenant(ids[0]), ids[0], NOW);
    expect(s.jobs.last7Days).toEqual([{ type: "ml.run", done: 3, failed: 1, queued: 1, running: 0, medianSec: 20, p90Sec: 28 }]);
    expect(s.jobs.oldestQueued).toEqual({ type: "ml.run", waitingSec: 120 });
    expect(s.jobs.recentFailures.map((f) => f.error)).toEqual(["worker exited 1"]);
  });

  it("reports the assistant's withheld answers as a share of checked ones", async () => {
    const s = await systemStatus(forTenant(ids[0]), ids[0], NOW);
    expect(s.assistant).toMatchObject({ questions: 3, guardChecked: 2, guardFailed: 1, guardFailureRate: 0.5, avgLatencyMs: 1340 });
    expect(s.assistant.byMode).toEqual({ llm: 1, template: 2, unsupported: 0 });
  });

  it("checks that the database answers", async () => {
    expect(await databaseHealth()).toMatchObject({ ok: true });
  });
});
