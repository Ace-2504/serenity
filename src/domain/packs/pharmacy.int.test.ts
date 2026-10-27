import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { expiryReport } from "@/server/analytics/expiry";
import { profitability } from "@/server/analytics/profitability";
import { LlmConfigError, OpenAICompatibleModel } from "@/server/assistant/llm";
import { createCampaign, updateCampaign } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { pharmacyDemoProfile } from "@/server/demo/profiles/pharmacy";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { generateDrafts } from "@/server/findings/engine";
import { commitImport, stageImport, type ImportSummary } from "@/server/ingest/pipeline";

/**
 * The pharmacy pack's acceptance test (docs/platform/08-domain-packs.md §4): the generic checks
 * pass on pharmacy data, and the pack's own rules (batch/expiry, MRP-inclusive billing, campaign
 * and data-sensitivity policy) hold. Full two-year period, few items and parties.
 */
const profile = scaledProfile(pharmacyDemoProfile, { end: pharmacyDemoProfile.end, maxItemsPerGroup: 8, maxPartiesPerSegment: 12 });

let data: DemoDataset;
let tenantId: string;
let db: ReturnType<typeof forTenant>;
let summary: ImportSummary;
let status: string;
const codeOf = new Map<string, string>();
const paise = (d: Prisma.Decimal) => d.mul(100).toNumber();

beforeAll(async () => {
  data = generateDemoDataset(profile, 42);
  tenantId = (await prisma.tenant.create({ data: { name: "Pharmacy pack test", domainPack: "pharmacy", isDemo: true } })).id;
  db = forTenant(tenantId);
  const source = await db.dataSource.create({ data: { tenantId, kind: "demo", name: "Demo" } });
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files: datasetToFiles(data) });
  status = staged.status;
  const committed = await commitImport(db, tenantId, staged.batchId);
  summary = committed.summary;
  for (const item of await db.item.findMany({ select: { id: true, sourceKey: true } })) codeOf.set(item.id, item.sourceKey);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("generic checks on pharmacy data (no pharmacy-specific code)", () => {
  it("validates and reconciles to its control totals, with MRP-inclusive lines", async () => {
    expect(status).toBe("validated");
    expect(summary.issues.errors).toBe(0);
    // Most retail lines carry only a tax-inclusive total; GST was backed out on import.
    expect(data.vouchers.filter((v) => v.amount_incl_tax).length).toBeGreaterThan(1000);
  });

  it("reproduces the source's closing stock exactly, quantity and value", () => {
    expect(summary.ledger?.stockCheck).toMatchObject({ items: data.stockSummary.length, qtyMismatches: 0, valueMismatches: 0 });
    expect(summary.ledger?.negativeStockEvents).toBe(0);
  });

  it("matches the generator's net sales and known-cost COGS in every financial year", async () => {
    for (const [fy, truth] of Object.entries(data.groundTruth.byFinancialYear)) {
      const start = 2000 + Number(fy.slice(0, 2));
      const [total] = await profitability(db, tenantId, { from: `${start}-04-01`, to: `${start + 1}-03-31` }, "total");
      expect({ fy, net: paise(total.netSalesKnownCost), cogs: paise(total.cogs) }).toEqual({ fy, net: truth.netSalesKnownCost, cogs: truth.cogsKnownCost });
    }
  });

  it("deletes the business, batches included", async () => {
    const other = (await prisma.tenant.create({ data: { name: "Pharmacy delete test", domainPack: "pharmacy" } })).id;
    const odb = forTenant(other);
    const source = await odb.dataSource.create({ data: { tenantId: other, kind: "demo", name: "Demo" } });
    const small = generateDemoDataset(scaledProfile(pharmacyDemoProfile, { end: "2024-12-31", maxItemsPerGroup: 2, maxPartiesPerSegment: 3 }), 7);
    const staged = await stageImport(odb, { tenantId: other, dataSourceId: source.id, files: datasetToFiles(small) });
    await commitImport(odb, other, staged.batchId);
    expect(await odb.batch.count()).toBeGreaterThan(0);
    await prisma.tenant.delete({ where: { id: other } });
    expect(await prisma.batch.count({ where: { tenantId: other } })).toBe(0);
  });
});

describe("batch and expiry", () => {
  it("knows every batch's stock on hand exactly as the generator left it", async () => {
    const report = await expiryReport(db, tenantId, data.meta.periodTo);
    const actual = report.batches.map((b) => `${codeOf.get(b.itemId)}|${b.batchNo}|${b.expiryDate}|${b.qty}`).sort();
    const expected = data.groundTruth.batchesOnHand.map((b) => `${b.itemCode}|${b.batchNo}|${b.expiryDate}|${b.qty}`).sort();
    expect(actual).toEqual(expected);
    expect(report.unbatchedQty).toBe(0);
    expect(report.negativeBatches).toBe(0);
  });

  it("finds the planted expired stock and short-dated buys", async () => {
    const report = await expiryReport(db, tenantId, data.meta.periodTo);
    const byBatch = new Map(report.batches.map((b) => [b.batchNo, b]));
    const expired = data.groundTruth.planted.expiredOpening.filter((p) => byBatch.has(p.batchNo));
    expect(expired.length).toBeGreaterThan(0);
    for (const p of expired) expect(byBatch.get(p.batchNo)!.bucket).toBe("expired");
    const shortDated = data.groundTruth.planted.shortDated.filter((p) => byBatch.has(p.batchNo));
    expect(shortDated.length).toBeGreaterThan(0);
    for (const p of shortDated) expect(byBatch.get(p.batchNo)!.daysToExpiry!).toBeLessThanOrEqual(90);
    expect(report.expiredValue).toBeGreaterThan(0);
    expect(report.atRiskValue).toBeGreaterThan(0);
  });

  it("raises expired and near-expiry findings, and never suggests promoting a prescription medicine", async () => {
    const drafts = await generateDrafts(db, tenantId, data.meta.periodTo);
    const expired = drafts.filter((d) => d.ruleId === "EXPIRED_STOCK");
    const near = drafts.filter((d) => d.ruleId === "NEAR_EXPIRY_AT_RISK");
    expect(expired).toHaveLength(1);
    expect(near.length).toBeGreaterThan(0);
    const items = new Map((await db.item.findMany({ select: { id: true, attributes: true } })).map((i) => [i.id, i.attributes as { schedule?: string }]));
    for (const f of near) {
      const schedule = items.get(f.entityId!)?.schedule;
      if (schedule && schedule !== "otc") expect(f.suggestedAction).toMatch(/Do not discount or promote/);
      expect(f.suggestedAction).not.toMatch(/offer a discount/);
    }
  });
});

describe("pharmacy policy", () => {
  it("refuses an offer in a pharmacy campaign", async () => {
    const c = await createCampaign(db, tenantId, "owner", { name: "Refill reminder", goal: "Remind regular patients", audience: { source: "segment", segment: "champion" } });
    await expect(updateCampaign(db, tenantId, "owner", c.id, { offer: { kind: "percent_off", value: 10 } })).rejects.toBeInstanceOf(WorkflowError);
    await expect(updateCampaign(db, tenantId, "owner", c.id, { subject: "Your medicines", body: "Dear {{name}}, your usual medicines are in stock." })).resolves.toBeTruthy();
  });

  it("never sends pharmacy customer data to a remote model server, even when remote use is allowed", () => {
    const remote = { LLM_BASE_URL: "https://api.example-ai.com", LLM_ALLOW_REMOTE: "1" };
    expect(() => new OpenAICompatibleModel(remote, { localOnly: true })).toThrow(LlmConfigError);
    expect(() => new OpenAICompatibleModel({ LLM_BASE_URL: "http://localhost:11434" }, { localOnly: true })).not.toThrow();
  });
});
