import { Prisma } from "@prisma/client";
import type { Period } from "@/server/analytics/profitability";

/**
 * Orders & customers (docs/platform/04-kpi-dictionary.md, section B).
 * Customer-level metrics use named buyers only: parties flagged anonymousBuyers (counter cash,
 * marketplaces) are excluded because their individual buyers are not identifiable.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
const DAY = 86_400_000;

export type OrderMetrics = {
  invoices: number;
  aov: number | null;
  medianOrderValue: number | null;
  unitsPerOrder: number | null;
  namedCustomers: number;
  ordersPerCustomer: number | null;
  repeatPurchaseRate: number | null;
  discountedOrderShare: number | null;
};

export async function orderMetrics(db: Raw, tenantId: string, period: Period): Promise<OrderMetrics> {
  const [row] = await db.$queryRaw<
    { invoices: bigint; total: Decimal | null; median: number | null; units: Decimal | null; discounted: bigint; customers: bigint; repeaters: bigint; named_invoices: bigint }[]
  >(Prisma.sql`
    WITH inv AS (
      SELECT v."id", v."partyId", p."anonymousBuyers" AS anon, SUM(l."taxableAmount") AS taxable, SUM(l."qty") AS units, BOOL_OR(l."discountAmount" > 0) AS discounted
      FROM "Voucher" v
      JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
      JOIN "Party" p ON p."tenantId" = v."tenantId" AND p."id" = v."partyId"
      WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'sales_invoice' AND v."date" BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY v."id", v."partyId", p."anonymousBuyers"
    ),
    per_customer AS (SELECT "partyId", COUNT(*) AS n FROM inv WHERE NOT anon GROUP BY 1)
    SELECT COUNT(*) AS invoices, SUM(taxable) AS total,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY taxable)::float AS median,
      SUM(units) AS units,
      COUNT(*) FILTER (WHERE discounted) AS discounted,
      (SELECT COUNT(*) FROM per_customer) AS customers,
      (SELECT COUNT(*) FROM per_customer WHERE n >= 2) AS repeaters,
      COUNT(*) FILTER (WHERE NOT anon) AS named_invoices
    FROM inv`);
  const invoices = Number(row?.invoices ?? 0);
  const customers = Number(row?.customers ?? 0);
  return {
    invoices,
    aov: invoices ? new D(row!.total ?? 0).div(invoices).toNumber() : null,
    medianOrderValue: row?.median ?? null,
    unitsPerOrder: invoices ? new D(row!.units ?? 0).div(invoices).toNumber() : null,
    namedCustomers: customers,
    ordersPerCustomer: customers ? Number(row!.named_invoices) / customers : null,
    repeatPurchaseRate: customers ? Number(row!.repeaters) / customers : null,
    discountedOrderShare: invoices ? Number(row!.discounted) / invoices : null
  };
}

export type Segment = "champion" | "loyal" | "new" | "at_risk" | "lapsing" | "inactive" | "steady";

export const SEGMENT_LABELS: Record<Segment, { label: string; meaning: string }> = {
  champion: { label: "Champions", meaning: "Bought recently, often, and spend the most" },
  loyal: { label: "Loyal", meaning: "Buy often; still active" },
  new: { label: "New", meaning: "First purchase in the last 90 days" },
  at_risk: { label: "At risk", meaning: "Used to buy a lot or often, but not recently" },
  lapsing: { label: "Lapsing", meaning: "Overdue by their own usual buying rhythm" },
  inactive: { label: "Inactive", meaning: "No purchase for a long time and little history" },
  steady: { label: "Steady", meaning: "Everyone else" }
};

export type CustomerRfm = {
  partyId: string;
  firstPurchase: string;
  lastPurchase: string;
  recencyDays: number;
  /** Invoices in the 365 days to asOf. */
  frequency: number;
  /** Net sales (ex-GST, after returns) in the 365 days to asOf. */
  monetary: number;
  lifetimeOrders: number;
  /** Median days between this customer's invoices; null with fewer than 3 invoices. */
  usualGapDays: number | null;
  /** Orders we would have expected since the silence became unusual, from this customer's own buying by calendar month. */
  expectedOrdersInSilence: number;
  /** Silent > 30 days and > 2x their usual gap, during months in which they normally buy (expected >= 1.5 orders). */
  overdue: boolean;
  /** Net sales (ex-GST, after returns) over all history. */
  lifetimeValue: number;
  r: number;
  f: number;
  m: number;
  segment: Segment;
};

/**
 * RFM as on a date. R/F/M scores are quintiles (5 = best) among customers who bought in the
 * last 2 years. "Lapsing" is rhythm- and season-aware: a valuable customer (lifetime value in the
 * top 60%, 3+ orders) silent for over 30 days and over twice their usual gap, during calendar months
 * in which their own history says they normally buy (at least 1.5 expected orders in the silent
 * window). So a weekly buyer silent for two months is flagged, a school in its usual off-season is
 * not, a school that skipped a whole season is, and one-off small buyers are left alone.
 */
export async function customerRfm(db: Raw, tenantId: string, asOf: string): Promise<CustomerRfm[]> {
  const rows = await db.$queryRaw<{ partyId: string; dates: Date[]; m12: Decimal | null; ltv: Decimal | null }[]>(Prisma.sql`
    WITH inv AS (
      SELECT v."partyId", v."date"
      FROM "Voucher" v JOIN "Party" p ON p."tenantId" = v."tenantId" AND p."id" = v."partyId"
      WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'sales_invoice'
        AND NOT p."anonymousBuyers" AND v."date" <= ${asOf}::date
    ),
    net12 AS (
      SELECT v."partyId", SUM(CASE WHEN v."type" = 'sales_invoice' THEN l."taxableAmount" ELSE -l."taxableAmount" END) AS m12
      FROM "Voucher" v JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
      WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" IN ('sales_invoice', 'sales_return')
        AND v."date" > (${asOf}::date - 365) AND v."date" <= ${asOf}::date
      GROUP BY 1
    )
    , lifetime AS (
      SELECT v."partyId", SUM(CASE WHEN v."type" = 'sales_invoice' THEN l."taxableAmount" ELSE -l."taxableAmount" END) AS ltv
      FROM "Voucher" v JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
      WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" IN ('sales_invoice', 'sales_return') AND v."date" <= ${asOf}::date
      GROUP BY 1
    )
    SELECT inv."partyId", array_agg(DISTINCT inv."date" ORDER BY inv."date") AS dates, MAX(net12.m12) AS m12, MAX(lifetime.ltv) AS ltv
    FROM inv LEFT JOIN net12 ON net12."partyId" = inv."partyId" LEFT JOIN lifetime ON lifetime."partyId" = inv."partyId"
    GROUP BY inv."partyId"`);

  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const base = rows
    .map((r) => {
      const times = r.dates.map((d) => d.getTime());
      const last = times[times.length - 1];
      const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY);
      return {
        partyId: r.partyId,
        firstPurchase: new Date(times[0]).toISOString().slice(0, 10),
        lastPurchase: new Date(last).toISOString().slice(0, 10),
        recencyDays: Math.round((asOfMs - last) / DAY),
        frequency: times.filter((t) => t > asOfMs - 365 * DAY).length,
        monetary: new D(r.m12 ?? 0).toNumber(),
        lifetimeOrders: times.length,
        usualGapDays: gaps.length >= 2 ? median(gaps) : null,
        expectedOrdersInSilence: expectedOrders(times, last + Math.max(30, 2 * (gaps.length >= 2 ? median(gaps) : 0)) * DAY, asOfMs),
        lifetimeValue: new D(r.ltv ?? 0).toNumber()
      };
    })
    .filter((c) => c.recencyDays <= 730);

  const quintile = (values: number[], higherIsBetter: boolean) => {
    const sorted = [...values].sort((a, b) => a - b);
    return (v: number) => {
      const rank = sorted.findIndex((x) => x >= v);
      const q = Math.min(5, Math.floor((rank / sorted.length) * 5) + 1);
      return higherIsBetter ? q : 6 - q;
    };
  };
  const rScore = quintile(base.map((c) => c.recencyDays), false);
  const fScore = quintile(base.map((c) => c.frequency), true);
  const mScore = quintile(base.map((c) => c.monetary), true);
  const valueScore = quintile(base.map((c) => c.lifetimeValue), true);

  return base.map((c) => {
    const r = rScore(c.recencyDays);
    const f = fScore(c.frequency);
    const m = mScore(c.monetary);
    const overdue = c.usualGapDays !== null && c.recencyDays > Math.max(30, 2 * c.usualGapDays) && c.expectedOrdersInSilence >= 1.5;
    let segment: Segment;
    if (Date.parse(`${c.firstPurchase}T00:00:00Z`) > asOfMs - 90 * DAY) segment = "new";
    else if (r >= 4 && f >= 4 && m >= 4) segment = "champion";
    else if (overdue && c.lifetimeOrders >= 3 && valueScore(c.lifetimeValue) >= 3) segment = "lapsing";
    else if (r <= 2 && (f >= 3 || m >= 4)) segment = "at_risk";
    else if (r === 1 && f <= 2) segment = "inactive";
    else if (f >= 4 && r >= 3) segment = "loyal";
    else segment = "steady";
    return { ...c, r, f, m, overdue, segment };
  });
}

export type Concentration = { buyers: number; top5Share: number | null; top10Share: number | null; hhi: number | null; top: { partyId: string; net: number; share: number }[] };

/** Dependence on a few buyers. Every party counts, so a marketplace counts as one buyer. */
export async function concentration(db: Raw, tenantId: string, period: Period): Promise<Concentration> {
  const rows = await db.$queryRaw<{ partyId: string; net: Decimal }[]>(Prisma.sql`
    SELECT v."partyId", SUM(CASE WHEN v."type" = 'sales_invoice' THEN l."taxableAmount" ELSE -l."taxableAmount" END) AS net
    FROM "Voucher" v JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
    WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" IN ('sales_invoice', 'sales_return')
      AND v."date" BETWEEN ${period.from}::date AND ${period.to}::date
    GROUP BY 1`);
  const list = rows.map((r) => ({ partyId: r.partyId, net: new D(r.net).toNumber() })).filter((r) => r.net > 0).sort((a, b) => b.net - a.net);
  const total = list.reduce((s, r) => s + r.net, 0);
  if (total <= 0) return { buyers: 0, top5Share: null, top10Share: null, hhi: null, top: [] };
  const share = (n: number) => list.slice(0, n).reduce((s, r) => s + r.net, 0) / total;
  return {
    buyers: list.length,
    top5Share: share(5),
    top10Share: share(10),
    hhi: Math.round(list.reduce((s, r) => s + (r.net / total) ** 2, 0) * 10_000),
    top: list.slice(0, 10).map((r) => ({ ...r, share: r.net / total }))
  };
}

/**
 * Orders this customer would normally have placed between `from` (the point at which their
 * silence became unusual: last purchase + max(30 days, 2x usual gap)) and asOf, from their own
 * history: purchases per calendar month per year of history, summed over those days.
 */
function expectedOrders(times: number[], from: number, asOfMs: number): number {
  const years = Math.max(1, (times[times.length - 1] - times[0]) / (365.25 * DAY));
  const perMonth = new Array<number>(12).fill(0);
  for (const t of times) perMonth[new Date(t).getUTCMonth()] += 1;
  let expected = 0;
  for (let t = from + DAY; t <= asOfMs; t += DAY) {
    const d = new Date(t);
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    expected += perMonth[d.getUTCMonth()] / years / daysInMonth;
  }
  return expected;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
