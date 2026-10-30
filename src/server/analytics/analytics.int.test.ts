import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDomainPack } from "@/domain/packs";
import { prisma } from "@/lib/prisma";
import { fillRate, payoutLag } from "@/server/analytics/channels";
import { concentration, customerRfm, orderMetrics } from "@/server/analytics/customers";
import { averageInventory, stockAgeing, stockoutDays, stockPositions, turnoverMetrics } from "@/server/analytics/inventory";
import { ageBills, averageOpen, creditVolume, daysMetric, openBills, sumPending } from "@/server/analytics/working-capital";
import { profitability } from "@/server/analytics/profitability";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { commitImport, stageImport, type ImportSummary } from "@/server/ingest/pipeline";

/** Full two-year period with every channel and planted problem, but few items and parties. */
const profile = scaledProfile(stationeryDemoProfile, { end: stationeryDemoProfile.end, maxItemsPerGroup: 5, maxPartiesPerSegment: 8 });

let data: DemoDataset;
let tenantId: string;
let db: ReturnType<typeof forTenant>;
let summary: ImportSummary;
const codeOf = new Map<string, string>();
const paise = (d: Prisma.Decimal) => d.mul(100).toNumber();

beforeAll(async () => {
  data = generateDemoDataset(profile, 42);
  const tenant = await prisma.tenant.create({ data: { name: "Analytics test", domainPack: "stationery", isDemo: true } });
  tenantId = tenant.id;
  db = forTenant(tenantId);
  const source = await db.dataSource.create({ data: { tenantId, kind: "demo", name: "Demo" } });
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files: datasetToFiles(data) });
  const committed = await commitImport(db, tenantId, staged.batchId);
  summary = committed.summary;
  for (const item of await db.item.findMany({ select: { id: true, sourceKey: true } })) codeOf.set(item.id, item.sourceKey);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

describe("stock ledger", () => {
  it("reproduces the source's closing stock exactly, quantity and value, for every item", () => {
    expect(summary.ledger?.stockCheck).toMatchObject({ items: data.stockSummary.length, qtyMismatches: 0, valueMismatches: 0 });
    expect(summary.ledger?.negativeStockEvents).toBe(0);
  });

  it("leaves cost unknown, never zero, for items whose opening value is missing", async () => {
    const missing = data.groundTruth.planted.missingOpeningValue.map((m) => m.itemCode);
    const unknownCost = await db.voucherLine.count({ where: { costBasis: "unknown", voucher: { type: "sales_invoice" } } });
    expect(unknownCost).toBe(summary.ledger?.unknownCostLines);
    const zeroCost = await db.voucherLine.count({ where: { costAmount: 0, voucher: { type: "sales_invoice" } } });
    expect(zeroCost).toBe(0);
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("profitability matches the generator's ground truth", () => {
  it("per channel and item: net sales, cost of goods sold and channel charges", async () => {
    const rows = await profitability(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo }, "channel_item");
    const actual = new Map(rows.map((r) => {
      const [channel, itemId] = r.key.split("|");
      return [`${channel}|${codeOf.get(itemId)}`, { netSales: paise(r.netSalesKnownCost), cogs: paise(r.cogs), charges: paise(r.channelCharges) }];
    }));
    const mismatches = data.groundTruth.contributionByChannelItem
      .filter((t) => t.netSales !== 0 || t.cogs !== 0 || t.charges !== 0)
      .filter((t) => JSON.stringify(actual.get(`${t.channel}|${t.itemCode}`)) !== JSON.stringify({ netSales: t.netSales, cogs: t.cogs, charges: t.charges }))
      .map((t) => `${t.channel}|${t.itemCode}: expected ${JSON.stringify(t)} got ${JSON.stringify(actual.get(`${t.channel}|${t.itemCode}`))}`);
    expect(mismatches).toEqual([]);
    const truthKeys = new Set(data.groundTruth.contributionByChannelItem.map((t) => `${t.channel}|${t.itemCode}`));
    const unexpected = [...actual.entries()].filter(([key, v]) => !truthKeys.has(key) && (v.netSales !== 0 || v.cogs !== 0 || v.charges !== 0));
    expect(unexpected).toEqual([]);
  });

  it("per financial year: net sales and known-cost COGS (returns counted in the credit note's year)", async () => {
    for (const [fy, truth] of Object.entries(data.groundTruth.byFinancialYear)) {
      const start = 2000 + Number(fy.slice(0, 2));
      const [total] = await profitability(db, tenantId, { from: `${start}-04-01`, to: `${start + 1}-03-31` }, "total");
      expect(paise(total.netSales), fy).toBe(truth.netSales);
      expect(paise(total.cogs), fy).toBe(truth.cogsKnownCost);
      expect(paise(total.salesReturns), fy).toBe(truth.salesReturns);
      expect(paise(total.discounts), fy).toBe(truth.discounts);
    }
  });

  it("reports partial cost coverage instead of a falsely complete profit", async () => {
    const [total] = await profitability(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo }, "total");
    expect(total.costCoverage).toBeLessThan(1);
    expect(total.costCoverage).toBeGreaterThan(0.9);
    expect(total.grossProfit.toFixed(2)).toBe(total.netSalesKnownCost.sub(total.cogs).toFixed(2));
  });

  it("shows the planted marketplace economics: Meesho contribution far below its gross margin", async () => {
    const rows = await profitability(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo }, "channel");
    const meesho = rows.find((r) => r.key === "meesho")!;
    const gm = meesho.grossProfit.div(meesho.netSalesKnownCost).toNumber();
    const cm = meesho.contribution.div(meesho.netSalesKnownCost).toNumber();
    expect(gm - cm).toBeGreaterThan(0.2);
  });
});

describe("inventory", () => {
  it("ages every unit on hand exactly once", async () => {
    const asOf = data.meta.periodTo;
    const positions = await stockPositions(db, tenantId, asOf);
    const ageing = await stockAgeing(db, tenantId, asOf, positions);
    for (const row of ageing) {
      const aged = row.buckets.reduce((s, b) => s.add(b.qty), new Prisma.Decimal(0));
      expect(aged.toFixed(3), codeOf.get(row.itemId)).toBe(positions.get(row.itemId)!.qty.toFixed(3));
    }
  });

  it("flags the planted slow movers by days since last sale", async () => {
    const positions = await stockPositions(db, tenantId, data.meta.periodTo);
    const slowDays = getDomainPack("stationery").thresholds.slowMovingDays;
    const byCode = new Map([...positions.values()].map((p) => [codeOf.get(p.itemId), p]));
    for (const { itemCode } of data.groundTruth.planted.slowMovers) {
      const p = byCode.get(itemCode)!;
      expect(p.qty.gt(0), itemCode).toBe(true);
      expect(p.daysSinceLastSale ?? Infinity, itemCode).toBeGreaterThanOrEqual(slowDays);
    }
  });

  it("finds repeated stockouts on the planted stockout items", async () => {
    const days = await stockoutDays(db, tenantId, data.meta.periodFrom, data.meta.periodTo);
    for (const { itemCode } of data.groundTruth.planted.stockoutItems) {
      const id = [...codeOf.entries()].find(([, code]) => code === itemCode)![0];
      expect(days.get(id) ?? 0, itemCode).toBeGreaterThan(5);
    }
  });

  it("computes turnover from cost of goods sold over average inventory at cost, and marks it partial when costs are missing", async () => {
    const period = { from: "2025-04-01", to: "2026-03-31" };
    const [total] = await profitability(db, tenantId, period, "total");
    const avg = await averageInventory(db, tenantId, period.from, period.to);
    expect(avg.points).toHaveLength(13);
    const { turnover, dio } = turnoverMetrics(total.cogs, avg.value, period.from, period.to, avg.unknownItems);
    expect(turnover.value).toBeCloseTo(total.cogs.div(avg.value).toNumber(), 2);
    expect(dio.value).toBe(Math.round(avg.value.div(total.cogs).mul(365).toNumber()));
    expect(turnover.status).toBe(avg.unknownItems > 0 ? "partial" : "ok");
  });

  it("refuses to compute turnover for a period without sales", () => {
    const { turnover } = turnoverMetrics(new Prisma.Decimal(0), new Prisma.Decimal(1000), "2030-01-01", "2030-12-31", 0);
    expect(turnover).toMatchObject({ value: null, status: "unavailable" });
  });
});

describe("receivables and payables", () => {
  it.each(["receivable", "payable"] as const)("rebuilds every open %s bill exactly as the source reports it", async (side) => {
    const bills = await openBills(db, tenantId, side, data.meta.periodTo);
    const numbers = new Map((await db.voucher.findMany({ where: { id: { in: bills.map((b) => b.billId) } }, select: { id: true, number: true } })).map((v) => [v.id, v.number]));
    const ours = new Map(bills.map((b) => [numbers.get(b.billId)!, Math.round(b.pending * 100)]));
    const source = new Map(data.outstanding.filter((o) => o.side === side).map((o) => [o.bill_ref, Math.round(Number(o.pending_incl_tax) * 100)]));
    expect(ours).toEqual(source);
  });

  it("ages every open receivable into exactly one bucket", async () => {
    const bills = await openBills(db, tenantId, "receivable", data.meta.periodTo);
    const aged = ageBills(bills);
    expect(aged.reduce((s, a) => s + a.amount, 0)).toBeCloseTo(sumPending(bills), 2);
    expect(aged.slice(1).reduce((s, a) => s + a.amount, 0)).toBeGreaterThan(0);
  });

  it("computes days sales outstanding from average receivables over credit sales", async () => {
    const period = { from: "2025-04-01", to: "2026-03-31" };
    const avg = await averageOpen(db, tenantId, "receivable", period);
    const credit = await creditVolume(db, tenantId, "receivable", period);
    const dso = daysMetric(avg.value, credit, 365, "credit sales");
    expect(avg.points).toHaveLength(13);
    expect(dso.value).toBe(Math.round((avg.value / credit) * 365));
    expect(dso.value).toBeGreaterThan(20);
    expect(dso.value).toBeLessThan(120);
  });
});

describe("customers", () => {
  it("measures orders, with customer metrics over named buyers only", async () => {
    const m = await orderMetrics(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo });
    const invoices = new Set(data.vouchers.filter((v) => v.voucher_type === "sales_invoice").map((v) => v.voucher_no)).size;
    expect(m.invoices).toBe(invoices);
    const anonymous = new Set(data.parties.filter((p) => p.buyer_identity === "anonymous").map((p) => p.party_code));
    const named = new Set(data.vouchers.filter((v) => v.voucher_type === "sales_invoice" && !anonymous.has(v.party_code)).map((v) => v.party_code));
    expect(m.namedCustomers).toBe(named.size);
    expect(m.repeatPurchaseRate).toBeGreaterThan(0);
    expect(m.repeatPurchaseRate).toBeLessThanOrEqual(1);
    expect(m.medianOrderValue).toBeGreaterThan(0);
  });

  it("flags the planted lapsing key accounts and the schools that skipped a season, but not schools in their normal off-season", async () => {
    const rfm = await customerRfm(db, tenantId, data.meta.periodTo);
    const parties = new Map((await db.party.findMany({ select: { id: true, sourceKey: true } })).map((p) => [p.id, p.sourceKey]));
    const segmentOf = new Map(rfm.map((c) => [parties.get(c.partyId), c.segment]));
    for (const { partyCode } of data.groundTruth.planted.lapsingKeyCustomers) expect(segmentOf.get(partyCode), partyCode).toBe("lapsing");
    for (const { partyCode } of data.groundTruth.planted.schoolsNotReordering) expect(segmentOf.get(partyCode), partyCode).toBe("lapsing");
    const skipped = new Set(data.groundTruth.planted.schoolsNotReordering.map((s) => s.partyCode));
    const activeSchools = rfm.filter((c) => parties.get(c.partyId)!.startsWith("SCH-") && !skipped.has(parties.get(c.partyId)!) && c.recencyDays < 200);
    expect(activeSchools.filter((c) => c.segment === "lapsing")).toEqual([]);
    const values = rfm.map((c) => c.lifetimeValue).sort((a, b) => a - b);
    const p40 = values[Math.floor(values.length * 0.4)];
    expect(rfm.filter((c) => c.segment === "lapsing" && c.lifetimeValue < p40)).toEqual([]);
  });

  it("measures dependence on top buyers", async () => {
    const c = await concentration(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo });
    expect(c.top5Share).toBeGreaterThan(0);
    expect(c.top10Share!).toBeGreaterThanOrEqual(c.top5Share!);
    expect(c.hhi).toBeGreaterThan(0);
    expect(c.top.reduce((s, t) => s + t.share, 0)).toBeCloseTo(c.top10Share!, 6);
  });
});

describe("channels", () => {
  it("fill rate per quick-commerce channel equals the generator's purchase-order units", async () => {
    const rows = await fillRate(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo }, "channel");
    const truth = data.groundTruth.purchaseOrderUnitsByChannel;
    expect(rows.map((r) => [r.key, r.ordered, r.supplied]).sort()).toEqual(Object.entries(truth).map(([k, v]) => [k, v.ordered, v.supplied]).sort());
    expect(Object.keys(truth).sort()).toEqual(["blinkit", "instamart", "zepto"]);
  });

  it("payout lag uses actual settlement dates for every marketplace", async () => {
    const lag = await payoutLag(db, tenantId, { from: data.meta.periodFrom, to: data.meta.periodTo });
    expect(lag.map((l) => l.channel).sort()).toEqual(["amazon", "meesho", "own_web"]);
    // Marketplaces pay after delivery and the return window; the demo's payment gateway settles the same day.
    for (const l of lag) {
      if (l.channel === "own_web") expect(l.medianDays).toBe(0);
      else expect(l.medianDays).toBeGreaterThanOrEqual(stationeryDemoProfile.channels.find((c) => c.id === l.channel)!.payout!.deliveryDays);
    }
  });
});
