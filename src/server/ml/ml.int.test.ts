import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { commitImport, stageImport } from "@/server/ingest/pipeline";
import { runMlWorker } from "@/server/ml/worker";

/** The Python worker against a real database: registry, honesty rules, isolation and supersession. */

const profile = scaledProfile(stationeryDemoProfile, { end: stationeryDemoProfile.end, maxItemsPerGroup: 5, maxPartiesPerSegment: 8 });
let tenantId: string;
let otherTenantId: string;

type RepeatMetrics = { summary: { mean_auc: Record<string, number>; best_baseline: string; model_wins_folds: number; folds: number } };
type ForecastMetrics = { methods: Record<string, { mean_mase: number }>; best: string; baseline: string };

beforeAll(async () => {
  const data = generateDemoDataset(profile, 42);
  for (const name of ["ML test", "ML other business"]) {
    const tenant = await prisma.tenant.create({ data: { name, domainPack: "stationery", isDemo: true } });
    const db = forTenant(tenant.id);
    const source = await db.dataSource.create({ data: { tenantId: tenant.id, kind: "demo", name: "Demo" } });
    const staged = await stageImport(db, { tenantId: tenant.id, dataSourceId: source.id, files: datasetToFiles(data) });
    await commitImport(db, tenant.id, staged.batchId);
    if (name === "ML test") tenantId = tenant.id;
    else otherTenantId = tenant.id;
  }
}, 600_000);

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await prisma.$disconnect();
});

describe("ML worker", () => {
  it("trains, tests against baselines and records what shipped and why", async () => {
    const summary = await runMlWorker(tenantId);
    expect(summary.status).toBe("ok");
    const versions = await prisma.modelVersion.findMany({ where: { tenantId, status: "active" } });
    expect(versions.map((v) => v.model).sort()).toEqual(["basket_pairs", "demand_forecast", "repeat_purchase"]);

    const repeat = versions.find((v) => v.model === "repeat_purchase")!;
    const rm = repeat.metrics as RepeatMetrics;
    const gain = rm.summary.mean_auc.model - rm.summary.mean_auc[rm.summary.best_baseline];
    // The honesty rule, checked against the recorded numbers.
    expect(repeat.shipped).toBe(gain >= 0.01 && rm.summary.model_wins_folds > rm.summary.folds / 2 ? "model" : rm.summary.best_baseline);
    expect(rm.summary.folds).toBe(3);

    const fc = versions.find((v) => v.model === "demand_forecast")!;
    const fm = fc.metrics as ForecastMetrics;
    const fgain = 1 - fm.methods[fm.best].mean_mase / fm.methods[fm.baseline].mean_mase;
    expect(fc.shipped).toBe(fm.best !== fm.baseline && fgain >= 0.02 ? fm.best : fm.baseline);
  }, 600_000);

  it("scores every named customer of this business only, with probabilities and reasons", async () => {
    const repeat = await prisma.modelVersion.findFirstOrThrow({ where: { tenantId, model: "repeat_purchase", status: "active" } });
    const predictions = await prisma.prediction.findMany({ where: { modelVersionId: repeat.id } });
    const named = await prisma.party.findMany({ where: { tenantId, anonymousBuyers: false, vouchers: { some: { type: "sales_invoice", status: "active" } } }, select: { id: true } });
    expect(new Set(predictions.map((p) => p.entityId))).toEqual(new Set(named.map((p) => p.id)));
    for (const p of predictions) {
      expect(p.tenantId).toBe(tenantId);
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
      expect((p.factors as unknown[]).length).toBeGreaterThan(0);
    }
    expect(await prisma.prediction.count({ where: { tenantId: otherTenantId } })).toBe(0);
  });

  it("forecasts only products sold in the last year, never below zero", async () => {
    const fc = await prisma.modelVersion.findFirstOrThrow({ where: { tenantId, model: "demand_forecast", status: "active" } });
    const points = await prisma.forecastPoint.findMany({ where: { modelVersionId: fc.id } });
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => p.qty >= 0 && p.method === fc.shipped && p.weekStart > fc.dataCutoff)).toBe(true);
    const items = await prisma.item.findMany({ where: { tenantId }, select: { id: true } });
    const ids = new Set(items.map((i) => i.id));
    expect(points.every((p) => ids.has(p.itemId))).toBe(true);
  });

  it("supersedes the previous run instead of mixing two runs' outputs", async () => {
    const before = await prisma.modelVersion.findMany({ where: { tenantId, status: "active" } });
    await runMlWorker(tenantId);
    const after = await prisma.modelVersion.groupBy({ by: ["status"], where: { tenantId }, _count: { _all: true } });
    expect(Object.fromEntries(after.map((a) => [a.status, a._count._all]))).toEqual({ active: 3, superseded: 3 });
    expect(await prisma.prediction.count({ where: { modelVersionId: { in: before.map((b) => b.id) } } })).toBe(0);
  }, 600_000);
});
