import { Prisma } from "@prisma/client";
import type { Period } from "@/server/analytics/profitability";

/**
 * Channel operations (docs/platform/04-kpi-dictionary.md, sections A and C).
 *
 *  fill_rate       = units supplied / units ordered on customer purchase orders dated in the period
 *  payout_lag_days = mean and median of (settlement date - order date) over orders with a linked
 *                    channel charge, by channel; actual dates, never an assumed payout cycle
 */

type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };

export type FillRateRow = { key: string; pos: number; lines: number; ordered: number; supplied: number; fillRate: number | null; shortLines: number; shortValue: number | null };

export async function fillRate(db: Raw, tenantId: string, period: Period, by: "channel" | "item" | "channel_item"): Promise<FillRateRow[]> {
  const key = by === "channel" ? Prisma.sql`o."channel"` : by === "item" ? Prisma.sql`o."itemId"` : Prisma.sql`o."channel" || '|' || o."itemId"`;
  const rows = await db.$queryRaw<{ key: string; pos: bigint; lines: bigint; ordered: number; supplied: number; short_lines: bigint; short_value: number | null }[]>(Prisma.sql`
    SELECT ${key} AS key, COUNT(DISTINCT o."poNumber") AS pos, COUNT(*) AS lines,
      SUM(o."qtyOrdered")::float AS ordered, SUM(LEAST(o."qtySupplied", o."qtyOrdered"))::float AS supplied,
      COUNT(*) FILTER (WHERE o."qtySupplied" < o."qtyOrdered") AS short_lines,
      SUM(GREATEST(o."qtyOrdered" - o."qtySupplied", 0) * o."unitPrice")::float AS short_value
    FROM "CustomerOrderLine" o
    WHERE o."tenantId" = ${tenantId} AND o."status" = 'active' AND o."poDate" BETWEEN ${period.from}::date AND ${period.to}::date
    GROUP BY 1
    ORDER BY 1`);
  return rows.map((r) => ({
    key: r.key,
    pos: Number(r.pos),
    lines: Number(r.lines),
    ordered: r.ordered,
    supplied: r.supplied,
    // Over-supply is capped per line, so one line cannot hide another's shortfall.
    fillRate: r.ordered > 0 ? r.supplied / r.ordered : null,
    shortLines: Number(r.short_lines),
    shortValue: r.short_value
  }));
}

export type PayoutLagRow = { channel: string; orders: number; meanDays: number; medianDays: number; p90Days: number };

/** Days from order to the settlement that paid it, per channel, for orders settled in the period. */
export async function payoutLag(db: Raw, tenantId: string, period: Period): Promise<PayoutLagRow[]> {
  const rows = await db.$queryRaw<{ channel: string; orders: bigint; mean: number; median: number; p90: number }[]>(Prisma.sql`
    WITH paid AS (
      SELECT c."channel", c."orderVoucherId", MIN(c."settlementDate") AS settled
      FROM "ChannelCharge" c
      WHERE c."tenantId" = ${tenantId} AND c."status" = 'active' AND c."orderVoucherId" IS NOT NULL AND NOT c."isTaxWithheld"
      GROUP BY 1, 2
    )
    SELECT p."channel", COUNT(*) AS orders,
      AVG(p.settled - v."date")::float AS mean,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY p.settled - v."date")::float AS median,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY p.settled - v."date")::float AS p90
    FROM paid p JOIN "Voucher" v ON v."tenantId" = ${tenantId} AND v."id" = p."orderVoucherId" AND v."status" = 'active'
    WHERE p.settled BETWEEN ${period.from}::date AND ${period.to}::date
    GROUP BY 1
    ORDER BY 1`);
  return rows.map((r) => ({ channel: r.channel, orders: Number(r.orders), meanDays: r.mean, medianDays: r.median, p90Days: r.p90 }));
}

/** Charges that name an order not (yet) found in the books, by channel: they cannot be attributed. */
export async function unlinkedCharges(db: Raw, tenantId: string, period: Period) {
  return db.$queryRaw<{ channel: string; charges: bigint; amount: number }[]>(Prisma.sql`
    SELECT "channel", COUNT(*) AS charges, SUM("amount")::float AS amount
    FROM "ChannelCharge"
    WHERE "tenantId" = ${tenantId} AND "status" = 'active' AND "orderVoucherId" IS NULL AND "orderRef" IS NOT NULL AND NOT "isTaxWithheld"
      AND "settlementDate" BETWEEN ${period.from}::date AND ${period.to}::date
    GROUP BY 1 ORDER BY 1`);
}

export type ChargeTotals = { channel: string; orderCosts: number; periodCosts: number; taxWithheld: number; gstOnFees: number };

/** Channel deductions by settlement date: costs tied to orders, costs not tied to any order, and tax credits. */
export async function chargeTotals(db: Raw, tenantId: string, period: Period): Promise<ChargeTotals[]> {
  const rows = await db.$queryRaw<{ channel: string; order_costs: number; period_costs: number; tax_withheld: number; gst: number }[]>(Prisma.sql`
    SELECT "channel",
      COALESCE(SUM("amount") FILTER (WHERE NOT "isTaxWithheld" AND "orderRef" IS NOT NULL), 0)::float AS order_costs,
      COALESCE(SUM("amount") FILTER (WHERE NOT "isTaxWithheld" AND "orderRef" IS NULL), 0)::float AS period_costs,
      COALESCE(SUM("amount") FILTER (WHERE "isTaxWithheld"), 0)::float AS tax_withheld,
      COALESCE(SUM("gstAmount"), 0)::float AS gst
    FROM "ChannelCharge"
    WHERE "tenantId" = ${tenantId} AND "status" = 'active' AND "settlementDate" BETWEEN ${period.from}::date AND ${period.to}::date
    GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => ({ channel: r.channel, orderCosts: r.order_costs, periodCosts: r.period_costs, taxWithheld: r.tax_withheld, gstOnFees: r.gst }));
}
