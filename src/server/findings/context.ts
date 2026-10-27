import { Prisma } from "@prisma/client";
import { getDomainPack } from "@/domain/packs";
import { concentration, customerRfm } from "@/server/analytics/customers";
import { stockoutDays, stockPositions } from "@/server/analytics/inventory";
import { profitability, type Period } from "@/server/analytics/profitability";
import { averageOpen, creditVolume, daysMetric, openBills } from "@/server/analytics/working-capital";
import type { TenantDb } from "@/server/db/tenant";
import { RULE_CONFIG } from "@/server/findings/types";

const DAY = 86_400_000;
export const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Everything the rules read, computed once per refresh as of a date. */
export async function buildContext(db: TenantDb, tenantId: string, asOf: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { domainPack: true } });
  const pack = getDomainPack(tenant.domainPack);
  const w = RULE_CONFIG.windowDays;
  const current: Period = { from: shift(asOf, -(w - 1)), to: asOf };
  const lastYear: Period = { from: shift(current.from, -365), to: shift(asOf, -365) };
  const year: Period = { from: shift(asOf, -364), to: asOf };
  const half: Period = { from: shift(asOf, -181), to: asOf };
  const halfLastYear: Period = { from: shift(half.from, -365), to: shift(asOf, -365) };

  const [items, groups, parties, positions, stockoutsYear, groupNow, groupThen, itemYear, channelItemYear, [businessYear], rfm, conc, bills] = await Promise.all([
    db.item.findMany({ select: { id: true, sourceKey: true, name: true, itemGroupId: true } }),
    db.itemGroup.findMany({ select: { id: true, name: true } }),
    db.party.findMany({ select: { id: true, name: true, segmentTag: true } }),
    stockPositions(db, tenantId, asOf),
    stockoutDays(db, tenantId, year.from, year.to),
    profitability(db, tenantId, current, "group"),
    profitability(db, tenantId, lastYear, "group"),
    profitability(db, tenantId, year, "item"),
    profitability(db, tenantId, year, "channel_item"),
    profitability(db, tenantId, year, "total"),
    customerRfm(db, tenantId, asOf),
    concentration(db, tenantId, year),
    openBills(db, tenantId, "receivable", asOf)
  ]);

  const [arNow, arThen, salesNow, salesThen] = await Promise.all([
    averageOpen(db, tenantId, "receivable", half),
    averageOpen(db, tenantId, "receivable", halfLastYear),
    creditVolume(db, tenantId, "receivable", half),
    creditVolume(db, tenantId, "receivable", halfLastYear)
  ]);
  const days = (p: Period) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / DAY) + 1;

  return {
    asOf,
    pack,
    periods: { current, lastYear, year, half, halfLastYear },
    items: new Map(items.map((i) => [i.id, i])),
    groupName: new Map(groups.map((g) => [g.id, g.name])),
    parties: new Map(parties.map((p) => [p.id, p])),
    positions,
    stockoutsYear,
    groupNow,
    groupThen,
    itemYear,
    channelItemYear,
    businessYear,
    businessMargin: businessYear && businessYear.netSalesKnownCost.gt(0) ? businessYear.grossProfit.div(businessYear.netSalesKnownCost).toNumber() : null,
    rfm,
    concentration: conc,
    receivables: bills,
    dso: { now: daysMetric(arNow.value, salesNow, days(half), "credit sales"), then: daysMetric(arThen.value, salesThen, days(halfLastYear), "credit sales"), arNow: bills.reduce((s, b) => s + b.pending, 0) },
    paymentDelays: await paymentDelays(db, tenantId, half, halfLastYear),
    purchaseCost: await purchaseCostByGroup(db, tenantId, current, lastYear),
    pastBuyers: await pastBuyers(
      db,
      tenantId,
      [...positions.values()].filter((p) => p.qty.gt(0) && (p.daysSinceLastSale ?? Infinity) >= pack.thresholds.slowMovingDays).map((p) => p.itemId)
    )
  };
}

/** Average purchase cost per unit by item group in two windows (indicative: includes mix effects). */
async function purchaseCostByGroup(db: TenantDb, tenantId: string, now: Period, then: Period) {
  const rows = await db.$queryRaw<{ groupId: string; window: string; unit: number }[]>`
    SELECT i."itemGroupId" AS "groupId", CASE WHEN v."date" >= ${now.from}::date THEN 'now' ELSE 'then' END AS window,
      (SUM(l."taxableAmount") / NULLIF(SUM(l."qty"), 0))::float AS unit
    FROM "VoucherLine" l
    JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
    JOIN "Item" i ON i."tenantId" = l."tenantId" AND i."id" = l."itemId"
    WHERE l."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'purchase_invoice'
      AND (v."date" BETWEEN ${now.from}::date AND ${now.to}::date OR v."date" BETWEEN ${then.from}::date AND ${then.to}::date)
    GROUP BY 1, 2`;
  const out = new Map<string, { now?: number; then?: number }>();
  for (const r of rows) out.set(r.groupId, { ...out.get(r.groupId), [r.window]: r.unit });
  return out;
}

/** Top past buyers (named customers) of each item, for "who to offer slow stock to". */
async function pastBuyers(db: TenantDb, tenantId: string, itemIds: string[]) {
  if (itemIds.length === 0) return new Map<string, { partyId: string; qty: number }[]>();
  const rows = await db.$queryRaw<{ itemId: string; partyId: string; qty: number }[]>`
    SELECT l."itemId", v."partyId", SUM(l."qty")::float AS qty
    FROM "VoucherLine" l
    JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
    JOIN "Party" p ON p."tenantId" = v."tenantId" AND p."id" = v."partyId"
    WHERE l."tenantId" = ${tenantId} AND v."status" = 'active' AND v."type" = 'sales_invoice' AND NOT p."anonymousBuyers"
      AND l."itemId" IN (${Prisma.join(itemIds)})
    GROUP BY 1, 2`;
  const out = new Map<string, { partyId: string; qty: number }[]>();
  for (const r of rows) out.set(r.itemId, [...(out.get(r.itemId) ?? []), { partyId: r.partyId, qty: r.qty }]);
  for (const list of out.values()) list.sort((a, b) => b.qty - a.qty);
  return out;
}
export type RuleContext = Awaited<ReturnType<typeof buildContext>>;

/** Per customer, for fully paid invoices due in each window: count, average days past due at final settlement, amount invoiced. */
async function paymentDelays(db: TenantDb, tenantId: string, now: Period, then: Period) {
  const rows = await db.$queryRaw<{ partyId: string; window: string; n: bigint; delay: number; amount: number }[]>`
    WITH final AS (
      SELECT ba."billVoucherId" AS id, MAX(s."date") AS paid_on, SUM(ba."amount") AS paid
      FROM "BillAllocation" ba JOIN "Voucher" s ON s."tenantId" = ba."tenantId" AND s."id" = ba."settlementVoucherId"
      WHERE ba."tenantId" = ${tenantId} AND s."status" = 'active' AND s."type" = 'receipt'
      GROUP BY 1
    )
    SELECT v."partyId", CASE WHEN v."dueDate" BETWEEN ${now.from}::date AND ${now.to}::date THEN 'now' ELSE 'then' END AS window,
      COUNT(*) AS n, AVG(f.paid_on - v."dueDate")::float AS delay, SUM(v."totalInclTax")::float AS amount
    FROM "Voucher" v JOIN final f ON f.id = v."id"
    WHERE v."tenantId" = ${tenantId} AND v."type" = 'sales_invoice' AND v."status" = 'active' AND v."dueDate" IS NOT NULL
      AND f.paid >= v."totalInclTax" - 0.01
      AND (v."dueDate" BETWEEN ${now.from}::date AND ${now.to}::date OR v."dueDate" BETWEEN ${then.from}::date AND ${then.to}::date)
    GROUP BY 1, 2`;
  type Window = { n: number; delay: number; amount: number };
  const out = new Map<string, { now?: Window; then?: Window }>();
  for (const r of rows) {
    const entry = out.get(r.partyId) ?? {};
    entry[r.window as "now" | "then"] = { n: Number(r.n), delay: r.delay, amount: r.amount };
    out.set(r.partyId, entry);
  }
  return out;
}

export const D = Prisma.Decimal;
