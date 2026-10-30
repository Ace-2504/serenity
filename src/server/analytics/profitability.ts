import { Prisma } from "@prisma/client";
import type { TenantDb } from "@/server/db/tenant";

/**
 * Sales & profitability metrics (docs/platform/04-kpi-dictionary.md, section A).
 *
 *  gross_sales   = sum(qty x rate) on sales invoices in the period
 *  discounts     = sum(line discount) on sales invoices
 *  sales_returns = sum(taxable) on credit notes dated in the period
 *  net_sales     = gross - discounts - returns
 *  cogs          = cost of lines sold - cost restored by returns (WAC, from the stock ledger)
 *  gross_profit  = net sales on known-cost lines - cogs   (never assumes zero cost)
 *  channel_charges = marketplace/gateway fees (ex-GST, ex tax withheld) spread over an order's
 *                    lines by taxable value; attributed to the order's period
 *  contribution  = gross_profit - channel_charges (known-cost lines)
 *
 * All amounts exclude GST. Results carry cost coverage so a partial figure is never shown as complete.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };

export type Period = { from: string; to: string };

export const GROUPINGS = {
  item: Prisma.sql`l."itemId"`,
  channel: Prisma.sql`COALESCE(v."channel", 'direct')`,
  channel_item: Prisma.sql`COALESCE(v."channel", 'direct') || '|' || l."itemId"`,
  group: Prisma.sql`COALESCE(i."itemGroupId", 'ungrouped')`,
  month: Prisma.sql`to_char(v."date", 'YYYY-MM')`,
  total: Prisma.sql`'total'`
} as const;
export type Grouping = keyof typeof GROUPINGS;

export type ProfitRow = {
  key: string;
  unitsSold: Decimal;
  grossSales: Decimal;
  discounts: Decimal;
  salesReturns: Decimal;
  netSales: Decimal;
  netSalesKnownCost: Decimal;
  cogs: Decimal;
  grossProfit: Decimal;
  channelCharges: Decimal;
  contribution: Decimal;
  /** Share of net sales whose cost is known (0-1); below 1 the profit figures are partial. */
  costCoverage: number;
  invoices: number;
};

export type ProfitFilters = { channel?: string; itemId?: string; groupId?: string };

export async function profitability(db: Raw, tenantId: string, period: Period, by: Grouping, filters: ProfitFilters = {}): Promise<ProfitRow[]> {
  const where = [
    Prisma.sql`v."tenantId" = ${tenantId}`,
    Prisma.sql`v."status" = 'active'`,
    Prisma.sql`v."type" IN ('sales_invoice', 'sales_return')`,
    Prisma.sql`v."date" BETWEEN ${period.from}::date AND ${period.to}::date`
  ];
  if (filters.channel) where.push(Prisma.sql`COALESCE(v."channel", 'direct') = ${filters.channel}`);
  if (filters.itemId) where.push(Prisma.sql`l."itemId" = ${filters.itemId}`);
  if (filters.groupId) where.push(Prisma.sql`i."itemGroupId" = ${filters.groupId}`);

  const rows = await db.$queryRaw<
    { key: string; units: Decimal; gross: Decimal; disc: Decimal; returns: Decimal; net: Decimal; net_known: Decimal; cogs: Decimal; charges: Decimal; invoices: bigint }[]
  >(Prisma.sql`
    WITH charges AS (
      SELECT c."orderVoucherId" AS vid, SUM(c."amount") AS amt
      FROM "ChannelCharge" c
      WHERE c."tenantId" = ${tenantId} AND c."status" = 'active' AND NOT c."isTaxWithheld" AND c."orderVoucherId" IS NOT NULL
      GROUP BY 1
    ),
    order_taxable AS (
      SELECT l."voucherId" AS vid, SUM(l."taxableAmount") AS tx
      FROM "VoucherLine" l JOIN charges ch ON ch.vid = l."voucherId"
      WHERE l."tenantId" = ${tenantId}
      GROUP BY 1
    ),
    lines AS (
      SELECT ${GROUPINGS[by]} AS key, v."id" AS vid, v."type", l."qty", l."grossAmount", l."discountAmount", l."taxableAmount", l."costAmount",
        CASE WHEN v."type" = 'sales_invoice' AND ch.amt IS NOT NULL AND ot.tx > 0 THEN ROUND(ch.amt * l."taxableAmount" / ot.tx, 2) ELSE 0 END AS charge
      FROM "VoucherLine" l
      JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
      JOIN "Item" i ON i."tenantId" = l."tenantId" AND i."id" = l."itemId"
      LEFT JOIN charges ch ON ch.vid = v."id"
      LEFT JOIN order_taxable ot ON ot.vid = v."id"
      WHERE ${Prisma.join(where, " AND ")}
    )
    SELECT key,
      SUM(CASE WHEN "type" = 'sales_invoice' THEN "qty" ELSE -"qty" END) AS units,
      SUM(CASE WHEN "type" = 'sales_invoice' THEN "grossAmount" ELSE 0 END) AS gross,
      SUM(CASE WHEN "type" = 'sales_invoice' THEN "discountAmount" ELSE 0 END) AS disc,
      SUM(CASE WHEN "type" = 'sales_return' THEN "taxableAmount" ELSE 0 END) AS returns,
      SUM(CASE WHEN "type" = 'sales_invoice' THEN "taxableAmount" ELSE -"taxableAmount" END) AS net,
      SUM(CASE WHEN "costAmount" IS NULL THEN 0 WHEN "type" = 'sales_invoice' THEN "taxableAmount" ELSE -"taxableAmount" END) AS net_known,
      SUM(CASE WHEN "costAmount" IS NULL THEN 0 WHEN "type" = 'sales_invoice' THEN "costAmount" ELSE -"costAmount" END) AS cogs,
      SUM(CASE WHEN "costAmount" IS NULL THEN 0 ELSE charge END) AS charges,
      COUNT(DISTINCT CASE WHEN "type" = 'sales_invoice' THEN vid END) AS invoices
    FROM lines
    GROUP BY key`);

  return rows.map((r) => {
    const net = new D(r.net);
    const netKnown = new D(r.net_known);
    const cogs = new D(r.cogs);
    const charges = new D(r.charges);
    const grossProfit = netKnown.sub(cogs);
    return {
      key: r.key,
      unitsSold: new D(r.units),
      grossSales: new D(r.gross),
      discounts: new D(r.disc),
      salesReturns: new D(r.returns),
      netSales: net,
      netSalesKnownCost: netKnown,
      cogs,
      grossProfit,
      channelCharges: charges,
      contribution: grossProfit.sub(charges),
      costCoverage: net.isZero() ? 1 : Math.min(1, netKnown.div(net).toNumber()),
      invoices: Number(r.invoices)
    };
  });
}

export const pct = (part: Decimal, whole: Decimal): number | null => (whole.isZero() ? null : part.div(whole).mul(100).toDecimalPlaces(1).toNumber());

/** The span of sales data a tenant has, used for default periods. */
export async function dataSpan(db: TenantDb): Promise<Period | null> {
  const span = await db.voucher.aggregate({ where: { status: "active", type: { in: ["sales_invoice", "sales_return", "purchase_invoice"] } }, _min: { date: true }, _max: { date: true } });
  if (!span._min.date || !span._max.date) return null;
  return { from: span._min.date.toISOString().slice(0, 10), to: span._max.date.toISOString().slice(0, 10) };
}
