import { Prisma } from "@prisma/client";

/**
 * Inventory metrics (docs/platform/04-kpi-dictionary.md, section C), from the WAC stock ledger.
 *
 *  inventory_value    = sum of each item's running value at the date (cost, ex-GST)
 *  avg_inventory      = mean of inventory value at the period's opening, each month end, and closing
 *  inventory_turnover = cogs / avg_inventory          (cost-based only; never sales / inventory)
 *  dio                = avg_inventory / cogs x days
 *  stock ageing       = on-hand quantity attributed to the most recent inward movements (FIFO
 *                       layers) to find its age; valued at the item's current WAC unit cost
 *  stockout_days      = days with closing stock <= 0 on which the item had sold in the prior 90 days
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
const DAY = 86_400_000;

export type StockPosition = {
  itemId: string;
  qty: Decimal;
  /** null when the item's cost is unknown (missing opening value). */
  value: Decimal | null;
  unitCost: Decimal | null;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
};

export async function stockPositions(db: Raw, tenantId: string, asOf: string): Promise<Map<string, StockPosition>> {
  const [positions, lastSales] = await Promise.all([
    db.$queryRaw<{ itemId: string; qty: Decimal; value: Decimal | null }[]>(Prisma.sql`
      SELECT DISTINCT ON (m."itemId") m."itemId", m."runningQty" AS qty, m."runningValue" AS value
      FROM "StockMovement" m
      WHERE m."tenantId" = ${tenantId} AND m."date" <= ${asOf}::date
      ORDER BY m."itemId", m."seq" DESC`),
    db.$queryRaw<{ itemId: string; last: Date }[]>(Prisma.sql`
      SELECT l."itemId", MAX(v."date") AS last
      FROM "VoucherLine" l JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
      WHERE l."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'sales_invoice' AND v."date" <= ${asOf}::date
      GROUP BY l."itemId"`)
  ]);
  const last = new Map(lastSales.map((r) => [r.itemId, r.last]));
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const out = new Map<string, StockPosition>();
  for (const p of positions) {
    const qty = new D(p.qty);
    const value = p.value === null ? null : new D(p.value);
    const lastSale = last.get(p.itemId) ?? null;
    out.set(p.itemId, {
      itemId: p.itemId,
      qty,
      value,
      unitCost: value !== null && qty.gt(0) ? value.div(qty) : null,
      lastSaleDate: lastSale ? lastSale.toISOString().slice(0, 10) : null,
      daysSinceLastSale: lastSale ? Math.round((asOfMs - lastSale.getTime()) / DAY) : null
    });
  }
  return out;
}

export type ValueAt = { date: string; value: Decimal; unknownItems: number };

export async function inventoryValueAt(db: Raw, tenantId: string, date: string): Promise<ValueAt> {
  const [row] = await db.$queryRaw<{ value: Decimal | null; unknown: bigint }[]>(Prisma.sql`
    SELECT SUM(p.value) AS value, COUNT(*) FILTER (WHERE p.value IS NULL AND p.qty <> 0) AS unknown
    FROM (
      SELECT DISTINCT ON (m."itemId") m."runningValue" AS value, m."runningQty" AS qty
      FROM "StockMovement" m
      WHERE m."tenantId" = ${tenantId} AND m."date" <= ${date}::date
      ORDER BY m."itemId", m."seq" DESC
    ) p`);
  return { date, value: new D(row?.value ?? 0), unknownItems: Number(row?.unknown ?? 0) };
}

/** Opening (day before the period), every month end inside it, and the closing date. */
export function valuationDates(from: string, to: string): string[] {
  const dates = new Set<string>([new Date(Date.parse(`${from}T00:00:00Z`) - DAY).toISOString().slice(0, 10)]);
  const end = Date.parse(`${to}T00:00:00Z`);
  let cursor = new Date(`${from}T00:00:00Z`);
  for (;;) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    if (monthEnd.getTime() >= end) break;
    dates.add(monthEnd.toISOString().slice(0, 10));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  dates.add(to);
  return [...dates];
}

export type MetricStatus = "ok" | "partial" | "unavailable";
export type Metric = { value: number | null; status: MetricStatus; note?: string };

export async function averageInventory(db: Raw, tenantId: string, from: string, to: string) {
  const points = await Promise.all(valuationDates(from, to).map((d) => inventoryValueAt(db, tenantId, d)));
  const unknown = Math.max(...points.map((p) => p.unknownItems));
  const value = points.reduce((s, p) => s.add(p.value), new D(0)).div(points.length);
  return { value, points, unknownItems: unknown };
}

export function turnoverMetrics(cogs: Decimal, avgInventory: Decimal, from: string, to: string, unknownItems: number): { turnover: Metric; dio: Metric } {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
  if (avgInventory.lte(0) || cogs.lte(0)) {
    const note = avgInventory.lte(0) ? "No inventory value in the period" : "No cost of goods sold in the period";
    return { turnover: { value: null, status: "unavailable", note }, dio: { value: null, status: "unavailable", note } };
  }
  const status: MetricStatus = unknownItems > 0 ? "partial" : "ok";
  const note = unknownItems > 0 ? `${unknownItems} item(s) have unknown cost and are excluded` : undefined;
  return {
    turnover: { value: cogs.div(avgInventory).toDecimalPlaces(2).toNumber(), status, note },
    dio: { value: avgInventory.div(cogs).mul(days).toDecimalPlaces(0).toNumber(), status, note }
  };
}

export const AGE_BUCKETS = [
  { label: "0–30 days", max: 30 },
  { label: "31–90 days", max: 90 },
  { label: "91–180 days", max: 180 },
  { label: "181–365 days", max: 365 },
  { label: "Over a year", max: Infinity }
] as const;

export type AgeingRow = { itemId: string; buckets: { qty: Decimal; value: Decimal | null }[]; oldestDays: number };

export async function stockAgeing(db: Raw, tenantId: string, asOf: string, positions: Map<string, StockPosition>): Promise<AgeingRow[]> {
  const inward = await db.$queryRaw<{ itemId: string; date: Date; qtyIn: Decimal }[]>(Prisma.sql`
    SELECT m."itemId", m."date", m."qtyIn"
    FROM "StockMovement" m
    WHERE m."tenantId" = ${tenantId} AND m."date" <= ${asOf}::date AND m."qtyIn" > 0
    ORDER BY m."itemId", m."seq" DESC`);
  const byItem = new Map<string, { date: Date; qtyIn: Decimal }[]>();
  for (const row of inward) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);

  const out: AgeingRow[] = [];
  for (const position of positions.values()) {
    if (position.qty.lte(0)) continue;
    let remaining = position.qty;
    const buckets = AGE_BUCKETS.map(() => ({ qty: new D(0), value: position.unitCost === null ? null : new D(0) }));
    let oldestDays = 0;
    for (const layer of byItem.get(position.itemId) ?? []) {
      if (remaining.lte(0)) break;
      const take = D.min(remaining, new D(layer.qtyIn));
      const age = Math.round((asOfMs - layer.date.getTime()) / DAY);
      oldestDays = Math.max(oldestDays, age);
      const bucket = buckets[AGE_BUCKETS.findIndex((b) => age <= b.max)];
      bucket.qty = bucket.qty.add(take);
      if (bucket.value !== null && position.unitCost !== null) bucket.value = bucket.value.add(take.mul(position.unitCost));
      remaining = remaining.sub(take);
    }
    out.push({ itemId: position.itemId, buckets, oldestDays });
  }
  return out;
}

/** Days in [from, to] with closing stock <= 0 while the item had sold within the previous 90 days. */
export async function stockoutDays(db: Raw, tenantId: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ itemId: string; date: Date; runningQty: Decimal; reason: string }[]>(Prisma.sql`
    SELECT m."itemId", m."date", m."runningQty", m."reason"
    FROM "StockMovement" m
    WHERE m."tenantId" = ${tenantId} AND m."date" <= ${to}::date AND m."date" >= (${from}::date - 90)
    ORDER BY m."itemId", m."seq"`);
  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  const out = new Map<string, number>();
  let i = 0;
  while (i < rows.length) {
    const itemId = rows[i].itemId;
    const closing = new Map<number, Decimal>();
    const sales: number[] = [];
    for (; i < rows.length && rows[i].itemId === itemId; i += 1) {
      const t = rows[i].date.getTime();
      closing.set(t, new D(rows[i].runningQty));
      if (rows[i].reason === "sales_invoice") sales.push(t);
    }
    // Walk the period day by day, carrying the last known closing quantity forward.
    let qty: Decimal | null = null;
    for (const [t, q] of closing) if (t < startMs) qty = q;
    let count = 0;
    let saleIdx = 0;
    for (let t = startMs; t <= endMs; t += DAY) {
      const q = closing.get(t);
      if (q !== undefined) qty = q;
      while (saleIdx < sales.length && sales[saleIdx] <= t) saleIdx += 1;
      const recentSale = saleIdx > 0 && t - sales[saleIdx - 1] <= 90 * DAY;
      if (qty !== null && qty.lte(0) && recentSale) count += 1;
    }
    if (count > 0) out.set(itemId, count);
  }
  return out;
}
