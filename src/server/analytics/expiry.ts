import { Prisma } from "@prisma/client";
import { stockPositions } from "@/server/analytics/inventory";

/**
 * Expiry exposure for batch-tracked stock (docs/platform/04-kpi-dictionary.md, section C2).
 *
 *  batch on hand   = units received into the batch - units issued from it (stock movements with the batch)
 *                    Issues recorded without a batch are taken from the item's earliest-expiring
 *                    batches first (FEFO), as a pharmacy is expected to sell them.
 *  value           = batch units x the item's current weighted-average unit cost (ex-GST)
 *  expired_value   = value of batches whose expiry date is before the as-of date
 *  near_expiry     = batches expiring within the pack's nearExpiryDays (90 for pharmacy)
 *  at_risk_units   = units not expected to sell before expiry at the item's recent sales rate
 *                    (last 90 days), selling earlier-expiring batches first. A projection, not a fact.
 *                    at_risk_value sums it over batches in the near-expiry window.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
const DAY = 86_400_000;
export const RATE_WINDOW_DAYS = 90;

export const EXPIRY_BUCKETS = [
  { id: "expired", label: "Expired", max: 0 },
  { id: "d30", label: "Expires within 30 days", max: 30 },
  { id: "d60", label: "In 31–60 days", max: 60 },
  { id: "d90", label: "In 61–90 days", max: 90 },
  { id: "d180", label: "In 91–180 days", max: 180 },
  { id: "later", label: "Later", max: Infinity }
] as const;
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number]["id"] | "no_expiry";

export type BatchExposure = {
  batchId: string;
  itemId: string;
  batchNo: string;
  expiryDate: string | null;
  /** Negative once expired. Null without an expiry date. */
  daysToExpiry: number | null;
  bucket: ExpiryBucket;
  qty: number;
  /** At cost; null when the item's cost is unknown. */
  value: number | null;
  mrp: number | null;
  /** Units expected to sell before expiry at the recent rate (0 once expired). */
  expectedToSell: number;
  atRiskQty: number;
  atRiskValue: number | null;
};

export type ExpiryReport = {
  asOf: string;
  batches: BatchExposure[];
  byBucket: { bucket: ExpiryBucket; label: string; batches: number; qty: number; value: number }[];
  expiredValue: number;
  nearExpiryValue: number;
  atRiskValue: number;
  /** Units on hand with no batch (e.g. opening stock given without batches). */
  unbatchedQty: number;
  /** Batches issued more than they received (data gaps); counted, then treated as empty. */
  negativeBatches: number;
  unknownCostBatches: number;
  /** Sales rate per item, units per day over the last RATE_WINDOW_DAYS. */
  dailyRate: Map<string, number>;
};

export function bucketFor(days: number | null): ExpiryBucket {
  if (days === null) return "no_expiry";
  if (days < 0) return "expired";
  return EXPIRY_BUCKETS.find((b) => b.id !== "expired" && days <= b.max)!.id;
}

export async function expiryReport(db: Raw, tenantId: string, asOf: string, nearExpiryDays = 90): Promise<ExpiryReport> {
  const rateFrom = new Date(Date.parse(`${asOf}T00:00:00Z`) - (RATE_WINDOW_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const [batchRows, unbatched, sold, positions] = await Promise.all([
    db.$queryRaw<{ batchId: string; itemId: string; batchNo: string; expiryDate: Date | null; mrp: Decimal | null; net: Decimal }[]>(Prisma.sql`
      SELECT b."id" AS "batchId", b."itemId", b."batchNo", b."expiryDate", b."mrp", COALESCE(SUM(m."qtyIn" - m."qtyOut"), 0) AS net
      FROM "Batch" b
      LEFT JOIN "StockMovement" m ON m."tenantId" = b."tenantId" AND m."batchId" = b."id" AND m."date" <= ${asOf}::date
      WHERE b."tenantId" = ${tenantId}
      GROUP BY b."id"`),
    db.$queryRaw<{ itemId: string; net: Decimal }[]>(Prisma.sql`
      SELECT m."itemId", SUM(m."qtyIn" - m."qtyOut") AS net
      FROM "StockMovement" m
      WHERE m."tenantId" = ${tenantId} AND m."batchId" IS NULL AND m."date" <= ${asOf}::date
        AND m."itemId" IN (SELECT DISTINCT "itemId" FROM "Batch" WHERE "tenantId" = ${tenantId})
      GROUP BY 1`),
    db.$queryRaw<{ itemId: string; qty: Decimal }[]>(Prisma.sql`
      SELECT l."itemId", SUM(l."qty") AS qty
      FROM "VoucherLine" l JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
      WHERE l."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'sales_invoice'
        AND v."date" BETWEEN ${rateFrom}::date AND ${asOf}::date
      GROUP BY 1`),
    stockPositions(db, tenantId, asOf)
  ]);

  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const dailyRate = new Map(sold.map((r) => [r.itemId, new D(r.qty).toNumber() / RATE_WINDOW_DAYS]));
  const byItem = new Map<string, { row: (typeof batchRows)[number]; qty: number; days: number | null }[]>();
  let negativeBatches = 0;
  for (const row of batchRows) {
    let qty = new D(row.net).toNumber();
    if (qty < 0) {
      negativeBatches += 1;
      qty = 0;
    }
    const days = row.expiryDate ? Math.round((row.expiryDate.getTime() - asOfMs) / DAY) : null;
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), { row, qty, days }]);
  }
  // Earliest expiry first; batches without a date last.
  for (const list of byItem.values()) list.sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity) || a.row.batchNo.localeCompare(b.row.batchNo));

  // Issues without a batch come out of the earliest-expiring stock (FEFO).
  let unbatchedQty = 0;
  for (const u of unbatched) {
    let net = new D(u.net).toNumber();
    if (net > 0) {
      unbatchedQty += net;
      continue;
    }
    for (const b of byItem.get(u.itemId) ?? []) {
      if (net >= 0) break;
      const take = Math.min(b.qty, -net);
      b.qty -= take;
      net += take;
    }
  }

  const batches: BatchExposure[] = [];
  let unknownCostBatches = 0;
  for (const [itemId, list] of byItem) {
    const unitCost = positions.get(itemId)?.unitCost?.toNumber() ?? null;
    const rate = dailyRate.get(itemId) ?? 0;
    const live = list.filter((b) => b.qty > 0);
    const expected = expectedSales(live, rate);
    for (const [n, b] of live.entries()) {
      const expectedToSell = expected[n];
      const atRiskQty = Math.round((b.qty - expectedToSell) * 1000) / 1000;
      if (unitCost === null) unknownCostBatches += 1;
      const money = (q: number) => (unitCost === null ? null : Math.round(q * unitCost * 100) / 100);
      batches.push({
        batchId: b.row.batchId,
        itemId,
        batchNo: b.row.batchNo,
        expiryDate: b.row.expiryDate ? b.row.expiryDate.toISOString().slice(0, 10) : null,
        daysToExpiry: b.days,
        bucket: bucketFor(b.days),
        qty: b.qty,
        value: money(b.qty),
        mrp: b.row.mrp === null ? null : new D(b.row.mrp).toNumber(),
        expectedToSell: Math.round(expectedToSell * 1000) / 1000,
        atRiskQty,
        atRiskValue: money(atRiskQty)
      });
    }
  }
  batches.sort((a, b) => (a.daysToExpiry ?? Infinity) - (b.daysToExpiry ?? Infinity) || (b.value ?? 0) - (a.value ?? 0));

  const byBucket = [...EXPIRY_BUCKETS.map((b) => ({ id: b.id as ExpiryBucket, label: b.label as string })), { id: "no_expiry" as ExpiryBucket, label: "No expiry date" }].map(({ id, label }) => {
    const inBucket = batches.filter((b) => b.bucket === id);
    return { bucket: id, label, batches: inBucket.length, qty: inBucket.reduce((s, b) => s + b.qty, 0), value: round2(inBucket.reduce((s, b) => s + (b.value ?? 0), 0)) };
  });
  const sum = (list: BatchExposure[], f: (b: BatchExposure) => number | null) => round2(list.reduce((s, b) => s + (f(b) ?? 0), 0));
  return {
    asOf,
    batches,
    byBucket,
    expiredValue: sum(batches.filter((b) => b.bucket === "expired"), (b) => b.value),
    nearExpiryValue: sum(batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry >= 0 && b.daysToExpiry <= nearExpiryDays), (b) => b.value),
    // Within the near-expiry window, so it is a part of nearExpiryValue.
    atRiskValue: sum(batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry >= 0 && b.daysToExpiry <= nearExpiryDays), (b) => b.atRiskValue),
    unbatchedQty,
    negativeBatches,
    unknownCostBatches,
    dailyRate
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Units of each batch expected to sell before it expires, at `dailyRate` units a day, selling
 * batches in the order given (earliest expiry first). Expired batches sell nothing; batches
 * without an expiry date are assumed to sell eventually.
 */
export function expectedSales(batches: { qty: number; days: number | null }[], dailyRate: number): number[] {
  let soldBefore = 0;
  return batches.map((b) => {
    if (b.days !== null && b.days < 0) return 0;
    // Demand until this batch expires, less what earlier-expiring batches are expected to take.
    const demand = b.days === null ? Infinity : Math.max(0, dailyRate * b.days - soldBefore);
    const sell = Math.min(b.qty, demand);
    soldBefore += sell;
    return sell;
  });
}
