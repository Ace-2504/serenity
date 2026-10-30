import { Prisma } from "@prisma/client";
import { valuationDates, type Metric } from "@/server/analytics/inventory";
import type { Period } from "@/server/analytics/profitability";

/**
 * Working capital (docs/platform/04-kpi-dictionary.md, section D).
 *
 * Receivables/payables are rebuilt from the ledger as on any date: bill total (incl. GST)
 * - credit/debit notes against it - settlements allocated to it, each counted only if dated
 * on or before that date. This allows month-end averages; the source's own bills-outstanding
 * report, when imported, is used to cross-check the result.
 *
 *  dso = average receivables / credit sales incl. GST x days   (credit sale = not settled on its own date)
 *  dpo = average payables / credit purchases incl. GST x days
 *  ccc = dio + dso - dpo
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Raw = { $queryRaw<T>(query: Prisma.Sql): Promise<T> };
const DAY = 86_400_000;

export type Side = "receivable" | "payable";
const TYPES: Record<Side, { bill: string; note: string }> = {
  receivable: { bill: "sales_invoice", note: "sales_return" },
  payable: { bill: "purchase_invoice", note: "purchase_return" }
};

export type OpenBill = { billId: string; partyId: string; number: string; billDate: string; dueDate: string; pending: number; daysOverdue: number };

/** Open bills as on a date. Missing due dates fall back to the party's credit days, else 30 days. */
export async function openBills(db: Raw, tenantId: string, side: Side, asOf: string): Promise<OpenBill[]> {
  const { bill, note } = TYPES[side];
  const rows = await db.$queryRaw<{ id: string; partyId: string; number: string; date: Date; due: Date; pending: Decimal }[]>(Prisma.sql`
    WITH notes AS (
      SELECT "originalVoucherId" AS id, SUM("totalInclTax") AS amt FROM "Voucher"
      WHERE "tenantId" = ${tenantId} AND "status" = 'active' AND "type" = ${note}::"VoucherType" AND "date" <= ${asOf}::date AND "originalVoucherId" IS NOT NULL
      GROUP BY 1
    ),
    settled AS (
      SELECT ba."billVoucherId" AS id, SUM(ba."amount") AS amt
      FROM "BillAllocation" ba JOIN "Voucher" s ON s."tenantId" = ba."tenantId" AND s."id" = ba."settlementVoucherId"
      WHERE ba."tenantId" = ${tenantId} AND s."status" = 'active' AND s."date" <= ${asOf}::date
      GROUP BY 1
    )
    SELECT v."id", v."partyId", v."number", v."date",
      COALESCE(v."dueDate", v."date" + COALESCE(p."creditDays", 30)) AS due,
      v."totalInclTax" - COALESCE(n.amt, 0) - COALESCE(s.amt, 0) AS pending
    FROM "Voucher" v
    JOIN "Party" p ON p."tenantId" = v."tenantId" AND p."id" = v."partyId"
    LEFT JOIN notes n ON n.id = v."id"
    LEFT JOIN settled s ON s.id = v."id"
    WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = ${bill}::"VoucherType" AND v."date" <= ${asOf}::date
      AND v."totalInclTax" - COALESCE(n.amt, 0) - COALESCE(s.amt, 0) > 0.005`);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  return rows.map((r) => ({
    billId: r.id,
    partyId: r.partyId,
    number: r.number,
    billDate: r.date.toISOString().slice(0, 10),
    dueDate: r.due.toISOString().slice(0, 10),
    pending: new D(r.pending).toNumber(),
    daysOverdue: Math.max(0, Math.round((asOfMs - r.due.getTime()) / DAY))
  }));
}

export const AGE_BUCKETS = ["Not yet due", "1–30 days overdue", "31–60 days overdue", "61–90 days overdue", "Over 90 days overdue"] as const;

/** Bucket index by days past the due date (0 = not yet due). */
export function ageBucket(bill: OpenBill): number {
  if (bill.daysOverdue === 0) return 0;
  if (bill.daysOverdue <= 30) return 1;
  if (bill.daysOverdue <= 60) return 2;
  if (bill.daysOverdue <= 90) return 3;
  return 4;
}

export function ageBills(bills: OpenBill[]) {
  return AGE_BUCKETS.map((label, i) => {
    const inBucket = bills.filter((b) => ageBucket(b) === i);
    return { label, amount: inBucket.reduce((s, b) => s + b.pending, 0), bills: inBucket.length };
  });
}

export const sumPending = (bills: OpenBill[]) => bills.reduce((s, b) => s + b.pending, 0);

/** Average open amount over the period's valuation dates (opening, month ends, closing). */
export async function averageOpen(db: Raw, tenantId: string, side: Side, period: Period) {
  const points = await Promise.all(valuationDates(period.from, period.to).map(async (d) => ({ date: d, amount: sumPending(await openBills(db, tenantId, side, d)) })));
  return { value: points.reduce((s, p) => s + p.amount, 0) / points.length, points };
}

/** Bills in the period that were not fully settled on their own date (credit sales/purchases), incl. GST. */
export async function creditVolume(db: Raw, tenantId: string, side: Side, period: Period): Promise<number> {
  const { bill } = TYPES[side];
  const [row] = await db.$queryRaw<{ total: Decimal | null }[]>(Prisma.sql`
    WITH same_day AS (
      SELECT ba."billVoucherId" AS id, SUM(ba."amount") AS amt
      FROM "BillAllocation" ba
      JOIN "Voucher" s ON s."tenantId" = ba."tenantId" AND s."id" = ba."settlementVoucherId"
      JOIN "Voucher" b ON b."tenantId" = ba."tenantId" AND b."id" = ba."billVoucherId"
      WHERE ba."tenantId" = ${tenantId} AND s."date" = b."date" AND s."status" = 'active'
      GROUP BY 1
    )
    SELECT SUM(v."totalInclTax") AS total
    FROM "Voucher" v LEFT JOIN same_day sd ON sd.id = v."id"
    WHERE v."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = ${bill}::"VoucherType"
      AND v."date" BETWEEN ${period.from}::date AND ${period.to}::date
      AND COALESCE(sd.amt, 0) < v."totalInclTax" - 0.005`);
  return new D(row?.total ?? 0).toNumber();
}

export function daysMetric(avgOpen: number, volume: number, days: number, what: string): Metric {
  if (volume <= 0) return { value: null, status: "unavailable", note: `No ${what} in the period` };
  return { value: Math.round((avgOpen / volume) * days), status: "ok" };
}

export function cashConversionCycle(dio: Metric, dso: Metric, dpo: Metric): Metric {
  if (dio.value === null || dso.value === null || dpo.value === null) {
    return { value: null, status: "unavailable", note: "Needs days of inventory, receivables and payables" };
  }
  const partial = [dio, dso, dpo].some((m) => m.status === "partial");
  return { value: dio.value + dso.value - dpo.value, status: partial ? "partial" : "ok", note: partial ? "One of its inputs is partial" : undefined };
}

/**
 * Scenario: cash released if receivables were collected at a target DSO. An estimate that assumes
 * the same sales volume and mix; it is labelled as such wherever shown.
 */
export function cashFromFasterCollection(receivables: number, currentDso: number, targetDso: number): number {
  if (currentDso <= 0 || targetDso >= currentDso) return 0;
  return receivables * (1 - targetDso / currentDso);
}

/** Scenario: cash recovered by clearing part of slow stock at an owner-set recovery rate (never assumed 100%). */
export function cashFromSlowStock(slowValue: number, clearPct: number, recoveryPct: number): number {
  return slowValue * (Math.min(Math.max(clearPct, 0), 100) / 100) * (Math.min(Math.max(recoveryPct, 0), 100) / 100);
}
