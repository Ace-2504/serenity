import { Prisma, type Finding, type FindingStatus } from "@prisma/client";
import { fillRate } from "@/server/analytics/channels";
import { concentration } from "@/server/analytics/customers";
import { expiryReport } from "@/server/analytics/expiry";
import { stockoutDays, stockPositions } from "@/server/analytics/inventory";
import { dataSpan, pct, profitability, type Period } from "@/server/analytics/profitability";
import { averageOpen, creditVolume, daysMetric } from "@/server/analytics/working-capital";
import type { TenantDb } from "@/server/db/tenant";
import { buildContext, shift } from "@/server/findings/context";
import { RULES } from "@/server/findings/rules";
import type { FindingDraft } from "@/server/findings/types";

/**
 * Findings lifecycle (docs/platform/02-architecture.md 2.3).
 *
 * refreshFindings runs the rules as of a date and upserts by (tenant, dedupeKey):
 *  - open / snoozed   -> content updated; a snooze that has expired reopens
 *  - resolved         -> reopened (the problem came back)
 *  - accepted         -> content updated, measurement plan frozen at acceptance
 *  - dismissed        -> stays dismissed, content updated
 *  - open or snoozed findings the rules no longer produce -> resolved by "system"
 *
 * All dates are data dates (the end of the imported data), not wall-clock dates, so a
 * business that imports weekly is measured consistently.
 */

export type MeasurePlan = FindingDraft["measurePlan"] & { startedOn?: string; checkOn?: string };
export type FindingAction = "accept" | "dismiss" | "snooze" | "reopen";
export const SNOOZE_DAYS = 30;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const LIVE: FindingStatus[] = ["open", "snoozed"];

/** End of the tenant's imported data, the default "as of" for findings. */
export async function dataEnd(db: TenantDb): Promise<string | null> {
  return (await dataSpan(db))?.to ?? null;
}

export async function generateDrafts(db: TenantDb, tenantId: string, asOf: string): Promise<FindingDraft[]> {
  const ctx = await buildContext(db, tenantId, asOf);
  return RULES.flatMap((rule) => rule.run(ctx));
}

const content = (d: FindingDraft) => ({
  entityType: d.entityType,
  entityId: d.entityId,
  entityLabel: d.entityLabel,
  severity: d.severity,
  title: d.title,
  whatHappened: d.whatHappened,
  whyItMatters: d.whyItMatters,
  suggestedAction: d.suggestedAction,
  evidence: d.evidence as Prisma.InputJsonValue,
  impactInr: d.impactInr === null ? null : new Prisma.Decimal(d.impactInr.toFixed(2)),
  impactFormula: d.impactFormula,
  assumptions: d.assumptions
});

export type RefreshSummary = { asOf: string; produced: number; created: number; updated: number; reopened: number; resolved: number };

export async function refreshFindings(db: TenantDb, tenantId: string, asOfInput?: string): Promise<RefreshSummary> {
  const asOf = asOfInput ?? (await dataEnd(db));
  if (!asOf) return { asOf: "", produced: 0, created: 0, updated: 0, reopened: 0, resolved: 0 };
  const drafts = await generateDrafts(db, tenantId, asOf);
  const existing = new Map((await db.finding.findMany()).map((f) => [f.dedupeKey, f]));
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const summary: RefreshSummary = { asOf, produced: drafts.length, created: 0, updated: 0, reopened: 0, resolved: 0 };
  const seen = new Set<string>();

  await db.$transaction(async (tx) => {
    for (const d of drafts) {
      seen.add(d.dedupeKey);
      const prev = existing.get(d.dedupeKey);
      if (!prev) {
        await tx.finding.create({
          data: { tenantId, ruleId: d.ruleId, dedupeKey: d.dedupeKey, asOf: asOfDate, measurePlan: d.measurePlan as Prisma.InputJsonValue, ...content(d) }
        });
        summary.created += 1;
        continue;
      }
      const reopen = prev.status === "resolved" || (prev.status === "snoozed" && prev.snoozedUntil !== null && prev.snoozedUntil <= asOfDate);
      await tx.finding.update({
        where: { id: prev.id },
        data: {
          ...content(d),
          asOf: asOfDate,
          // Once accepted, the baseline and target stay as they were when the owner agreed to act.
          ...(prev.status === "accepted" ? {} : { measurePlan: d.measurePlan as Prisma.InputJsonValue }),
          ...(reopen ? { status: "open", snoozedUntil: null, statusChangedAt: new Date(), statusChangedBy: "system" } : {})
        }
      });
      if (reopen) summary.reopened += 1;
      else summary.updated += 1;
    }
    const gone = [...existing.values()].filter((f) => !seen.has(f.dedupeKey) && LIVE.includes(f.status));
    if (gone.length) {
      await tx.finding.updateMany({
        where: { id: { in: gone.map((f) => f.id) } },
        data: { status: "resolved", snoozedUntil: null, statusChangedAt: new Date(), statusChangedBy: "system" }
      });
      summary.resolved = gone.length;
    }
  });
  return summary;
}

export class FindingActionError extends Error {}

/** Owner decision on a finding. Accepting records when measurement starts and when it is checked. */
export async function actOnFinding(db: TenantDb, tenantId: string, findingId: string, action: FindingAction, userId: string, note?: string): Promise<Finding> {
  const finding = await db.finding.findFirst({ where: { id: findingId } });
  if (!finding) throw new FindingActionError("Finding not found");
  const allowed: Record<FindingAction, FindingStatus[]> = {
    accept: ["open", "snoozed"],
    dismiss: ["open", "snoozed"],
    snooze: ["open"],
    reopen: ["dismissed", "snoozed"]
  };
  if (!allowed[action].includes(finding.status)) throw new FindingActionError(`Cannot ${action} a finding that is ${finding.status}`);
  const startedOn = iso(finding.asOf);
  const plan = finding.measurePlan as MeasurePlan;
  const data: Prisma.FindingUpdateInput =
    action === "accept"
      ? { status: "accepted", measurePlan: { ...plan, startedOn, checkOn: shift(startedOn, plan.checkAfterDays) } }
      : action === "dismiss"
        ? { status: "dismissed" }
        : action === "snooze"
          ? { status: "snoozed", snoozedUntil: new Date(`${shift(startedOn, SNOOZE_DAYS)}T00:00:00Z`) }
          : { status: "open", snoozedUntil: null };
  return db.$transaction(async (tx) => {
    const updated = await tx.finding.update({
      where: { id: finding.id },
      data: { ...data, statusChangedAt: new Date(), statusChangedBy: userId, ownerNote: note?.slice(0, 2000) ?? finding.ownerNote }
    });
    await tx.auditLog.create({
      data: { tenantId, actorUserId: userId, action: `finding.${action}`, entity: "Finding", entityId: finding.id, before: { status: finding.status }, after: { status: updated.status, note: note ?? null } }
    });
    return updated;
  });
}

const CAVEAT =
  "Measured from data recorded after you accepted. Other changes in the same period (season, prices, customers) can also move this number, so it shows what happened, not proof that the action caused it.";

type Measured = { value: number | null; realised: number | null; note?: string };

/** Measures one accepted finding's metric over [startedOn + 1, checkOn]. Deterministic, ledger-only. */
export async function measure(db: TenantDb, tenantId: string, f: Finding, plan: MeasurePlan): Promise<Measured> {
  const window: Period = { from: shift(plan.startedOn!, 1), to: plan.checkOn! };
  const days = plan.checkAfterDays;
  switch (plan.metric) {
    case "item_stock_value": {
      const pos = (await stockPositions(db, tenantId, window.to)).get(f.entityId!);
      const value = pos?.value?.toNumber() ?? 0;
      return { value, realised: Math.max(0, plan.baseline - value), note: "Realised = fall in stock value at cost (cash no longer tied up in this item)." };
    }
    case "group_gross_margin":
    case "group_discount_rate": {
      const [row] = await profitability(db, tenantId, window, "total", { groupId: f.entityId! });
      if (!row || row.netSalesKnownCost.lte(0)) return { value: null, realised: null, note: "No sales of this group in the period." };
      if (plan.metric === "group_gross_margin") {
        const gm = pct(row.grossProfit, row.netSalesKnownCost)!;
        return { value: gm, realised: ((gm - plan.baseline) / 100) * row.netSalesKnownCost.toNumber(), note: "Realised = margin points regained × net sales in the period." };
      }
      const disc = pct(row.discounts, row.grossSales) ?? 0;
      return { value: disc, realised: ((plan.baseline - disc) / 100) * row.grossSales.toNumber(), note: "Realised = discount points saved × gross sales in the period." };
    }
    case "dso": {
      const [avg, sales] = await Promise.all([averageOpen(db, tenantId, "receivable", window), creditVolume(db, tenantId, "receivable", window)]);
      return { value: daysMetric(avg.value, sales, days, "credit sales").value, realised: null };
    }
    case "payer_delay": {
      const subjects = plan.subjects ?? [];
      if (subjects.length === 0) return { value: null, realised: null };
      const [row] = await db.$queryRaw<{ n: bigint; delay: number | null }[]>`
        WITH final AS (
          SELECT ba."billVoucherId" AS id, MAX(s."date") AS paid_on, SUM(ba."amount") AS paid
          FROM "BillAllocation" ba JOIN "Voucher" s ON s."tenantId" = ba."tenantId" AND s."id" = ba."settlementVoucherId"
          WHERE ba."tenantId" = ${tenantId} AND s."status" = 'active' AND s."type" = 'receipt' AND s."date" <= ${window.to}::date
          GROUP BY 1
        )
        SELECT COUNT(*) AS n, AVG(COALESCE(CASE WHEN f.paid >= v."totalInclTax" - 0.01 THEN f.paid_on END, ${window.to}::date) - v."dueDate")::float AS delay
        FROM "Voucher" v LEFT JOIN final f ON f.id = v."id"
        WHERE v."tenantId" = ${tenantId} AND v."type" = 'sales_invoice' AND v."status" = 'active' AND v."dueDate" BETWEEN ${window.from}::date AND ${window.to}::date
          AND v."partyId" IN (${Prisma.join(subjects)})`;
      if (!row || Number(row.n) === 0) return { value: null, realised: null, note: "No invoices from these customers fell due in the period." };
      return { value: row.delay, realised: null, note: "Invoices still unpaid at the check date count as late up to that date." };
    }
    case "channel_fill_rate": {
      const channel = f.dedupeKey.split("|")[1];
      const row = (await fillRate(db, tenantId, window, "channel")).find((r) => r.key === channel);
      if (!row || row.fillRate === null) return { value: null, realised: null, note: "No purchase orders from this platform in the period." };
      return { value: row.fillRate * 100, realised: null };
    }
    case "top5_share": {
      const c = await concentration(db, tenantId, window);
      return { value: c.top5Share === null ? null : c.top5Share * 100, realised: null };
    }
    case "customer_orders": {
      const orders = await db.voucher.findMany({
        where: { partyId: f.entityId!, type: "sales_invoice", status: "active", date: { gte: new Date(`${window.from}T00:00:00Z`), lte: new Date(`${window.to}T00:00:00Z`) } },
        select: { id: true }
      });
      if (orders.length === 0) return { value: 0, realised: 0 };
      const [mine] = await db.$queryRaw<{ gp: number | null }[]>`
        SELECT SUM(l."taxableAmount" - l."costAmount")::float AS gp FROM "VoucherLine" l
        WHERE l."tenantId" = ${tenantId} AND l."costAmount" IS NOT NULL AND l."voucherId" IN (${Prisma.join(orders.map((o) => o.id))})`;
      return { value: orders.length, realised: mine?.gp ?? null, note: "Realised = gross profit on this customer's orders in the period." };
    }
    case "expired_stock_value": {
      const report = await expiryReport(db, tenantId, window.to);
      return { value: report.expiredValue, realised: Math.max(0, plan.baseline - report.expiredValue), note: "Realised = fall in expired stock at cost (returned, credited or written off)." };
    }
    case "batch_stock_value": {
      const subjects = new Set(plan.subjects ?? []);
      const report = await expiryReport(db, tenantId, window.to);
      const value = report.batches.filter((b) => subjects.has(b.batchId)).reduce((s, b) => s + (b.value ?? 0), 0);
      return { value, realised: null, note: "Includes these batches whether or not they have expired; selling or returning them is what lowers it." };
    }
    case "item_stockout_days":
      return { value: (await stockoutDays(db, tenantId, window.from, window.to)).get(f.entityId!) ?? 0, realised: null };
    case "channel_item_contribution": {
      const channel = f.dedupeKey.split("|")[1];
      const [row] = await profitability(db, tenantId, window, "total", { channel, itemId: f.entityId! });
      if (!row || row.unitsSold.lte(0)) return { value: null, realised: null, note: "No sales of this product on the channel in the period." };
      const perUnit = row.contribution.toNumber() / row.unitsSold.toNumber();
      return { value: perUnit, realised: (perUnit - plan.baseline) * row.unitsSold.toNumber(), note: "Realised = change in contribution per unit × units sold in the period." };
    }
    default:
      return { value: null, realised: null, note: `Unknown metric ${plan.metric}` };
  }
}

export function verdictFor(plan: MeasurePlan, value: number | null): "achieved" | "not_achieved" | "insufficient_data" {
  if (value === null) return "insufficient_data";
  return (plan.direction === "decrease" ? value <= plan.target : value >= plan.target) ? "achieved" : "not_achieved";
}

/** Records outcomes for accepted findings whose check date the data has reached. */
export async function measureOutcomes(db: TenantDb, tenantId: string, asOfInput?: string): Promise<{ measured: number }> {
  const asOf = asOfInput ?? (await dataEnd(db));
  if (!asOf) return { measured: 0 };
  const due = (await db.finding.findMany({ where: { status: "accepted", outcomes: { none: {} } } })).filter((f) => {
    const plan = f.measurePlan as MeasurePlan;
    return plan.checkOn !== undefined && plan.checkOn <= asOf;
  });
  for (const f of due) {
    const plan = f.measurePlan as MeasurePlan;
    const m = await measure(db, tenantId, f, plan);
    await db.findingOutcome.create({
      data: {
        tenantId,
        findingId: f.id,
        measuredOn: new Date(`${plan.checkOn}T00:00:00Z`),
        metricValue: m.value === null ? null : new Prisma.Decimal(m.value.toFixed(4)),
        realisedImpactInr: m.realised === null ? null : new Prisma.Decimal(m.realised.toFixed(2)),
        verdict: verdictFor(plan, m.value),
        notes: [m.note, CAVEAT].filter(Boolean).join(" ")
      }
    });
  }
  return { measured: due.length };
}

/** Recommendation track record: estimates and realised figures are kept apart, never summed together. */
export async function trackRecord(db: TenantDb) {
  const [byStatus, outcomes, accepted] = await Promise.all([
    db.finding.groupBy({ by: ["status"], _count: { _all: true } }),
    db.findingOutcome.findMany({ select: { verdict: true, realisedImpactInr: true } }),
    db.finding.findMany({ where: { status: "accepted" }, select: { impactInr: true } })
  ]);
  const count = (s: FindingStatus) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const decided = count("accepted") + count("dismissed");
  const raised = decided + count("open") + count("snoozed") + count("resolved");
  return {
    raised,
    decided,
    accepted: count("accepted"),
    dismissed: count("dismissed"),
    reviewRate: raised ? decided / raised : null,
    acceptanceRate: decided ? count("accepted") / decided : null,
    estimatedImpactAccepted: accepted.reduce((s, f) => s + (f.impactInr?.toNumber() ?? 0), 0),
    measured: outcomes.length,
    achieved: outcomes.filter((o) => o.verdict === "achieved").length,
    realisedImpact: outcomes.reduce((s, o) => s + (o.realisedImpactInr?.toNumber() ?? 0), 0)
  };
}
