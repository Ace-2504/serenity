import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TenantDb } from "@/server/db/tenant";
import { llmSettings } from "@/server/assistant/llm";
import { transportName } from "@/server/campaigns/transport";

/**
 * Operational health of one business: imports, background jobs, assistant answers, models and
 * outgoing messages. Counts and timings only; no business figures.
 */

const DAY = 86_400_000;

export type JobStats = { type: string; done: number; failed: number; queued: number; running: number; medianSec: number | null; p90Sec: number | null };

export async function systemStatus(db: TenantDb, tenantId: string, now = new Date()) {
  const since30 = new Date(now.getTime() - 30 * DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const [imports, sources, jobRows, oldestQueued, failures, answers, versions, outbox] = await Promise.all([
    db.importBatch.groupBy({ by: ["status"], where: { createdAt: { gte: since30 } }, _count: { _all: true } }),
    db.dataSource.findMany({
      select: { id: true, name: true, kind: true, isDemo: true, importBatches: { where: { status: "committed" }, orderBy: { committedAt: "desc" }, take: 1, select: { committedAt: true, fileName: true } } },
      orderBy: { createdAt: "asc" }
    }),
    prisma.$queryRaw<{ type: string; status: string; n: bigint; median: number | null; p90: number | null }[]>`
      SELECT "type", "status"::text AS status, COUNT(*) AS n,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("finishedAt" - "createdAt"))) FILTER (WHERE "finishedAt" IS NOT NULL) AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("finishedAt" - "createdAt"))) FILTER (WHERE "finishedAt" IS NOT NULL) AS p90
      FROM "Job" WHERE "tenantId" = ${tenantId} AND "createdAt" >= ${since7}
      GROUP BY "type", "status"`,
    db.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, select: { createdAt: true, type: true } }),
    db.job.findMany({ where: { status: "failed", createdAt: { gte: since7 } }, orderBy: { finishedAt: "desc" }, take: 5, select: { id: true, type: true, error: true, attempts: true, finishedAt: true } }),
    db.assistantLog.groupBy({ by: ["mode", "guardOk"], where: { createdAt: { gte: since30 } }, _count: { _all: true }, _avg: { latencyMs: true } }),
    db.modelVersion.findMany({ where: { status: "active" }, select: { model: true, shipped: true, trainedAt: true, dataCutoff: true } }),
    db.outboxMessage.groupBy({ by: ["status"], where: { createdAt: { gte: since30 } }, _count: { _all: true } })
  ]);

  const byType = new Map<string, JobStats>();
  for (const r of jobRows) {
    const s = byType.get(r.type) ?? { type: r.type, done: 0, failed: 0, queued: 0, running: 0, medianSec: null, p90Sec: null };
    s[r.status as "done" | "failed" | "queued" | "running"] = Number(r.n);
    if (r.status === "done") [s.medianSec, s.p90Sec] = [r.median, r.p90];
    byType.set(r.type, s);
  }

  const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => boolean) => rows.filter(pick).reduce((t, r) => t + r._count._all, 0);
  const guardChecked = count(answers, (a) => a.guardOk !== null);
  const guardFailed = count(answers, (a) => a.guardOk === false);
  const totalAnswers = count(answers, () => true);
  const latencyWeighted = answers.reduce((t, a) => t + (a._avg.latencyMs ?? 0) * a._count._all, 0);
  const llm = safeLlmSettings();

  return {
    imports: {
      last30Days: Object.fromEntries(imports.map((r) => [r.status, r._count._all])) as Partial<Record<string, number>>,
      sources: sources.map((s) => ({ name: s.name, kind: s.kind, isDemo: s.isDemo, lastCommittedAt: s.importBatches[0]?.committedAt ?? null, lastFile: s.importBatches[0]?.fileName ?? null }))
    },
    jobs: {
      last7Days: [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)),
      oldestQueued: oldestQueued ? { type: oldestQueued.type, waitingSec: Math.round((now.getTime() - oldestQueued.createdAt.getTime()) / 1000) } : null,
      recentFailures: failures
    },
    assistant: {
      questions: totalAnswers,
      byMode: Object.fromEntries(["llm", "template", "unsupported"].map((m) => [m, count(answers, (a) => a.mode === m)])),
      guardChecked,
      guardFailed,
      guardFailureRate: guardChecked ? guardFailed / guardChecked : null,
      avgLatencyMs: totalAnswers ? Math.round(latencyWeighted / totalAnswers) : null
    },
    models: versions,
    outbox: Object.fromEntries(outbox.map((r) => [r.status, r._count._all])) as Partial<Record<string, number>>,
    settings: {
      jobsMode: process.env.JOBS_MODE === "worker" ? "separate worker process" : "inside the web server",
      emailTransport: transportName() === "smtp" ? "SMTP server (messages are sent)" : "local outbox (nothing is sent)",
      modelServer: llm ? `${llm.host} (${llm.local ? "on this network" : llm.remoteAllowed ? "remote, allowed by the operator" : "remote, refused"})` : "invalid LLM_BASE_URL",
      model: llm?.model ?? null,
      mlAutorun: process.env.ML_AUTORUN === "1",
      trustProxy: process.env.TRUST_PROXY === "1"
    }
  };
}

function safeLlmSettings() {
  try {
    return llmSettings();
  } catch {
    return null;
  }
}

/** Database reachability for the health endpoint: no business data, just a round trip. */
export async function databaseHealth(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw(Prisma.sql`SELECT 1`);
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, ms: Date.now() - started, error: (error as Error).name };
  }
}
