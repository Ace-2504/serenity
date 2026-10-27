import { z } from "zod";
import { formatInrCompact as inr, formatPct } from "@/components/bi/format";
import { chargeTotals, fillRate, payoutLag } from "@/server/analytics/channels";
import { channelLabel } from "@/server/analytics/context";
import { concentration, customerRfm, SEGMENT_LABELS } from "@/server/analytics/customers";
import { expiryReport } from "@/server/analytics/expiry";
import { stockPositions } from "@/server/analytics/inventory";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan, pct, profitability, type Period } from "@/server/analytics/profitability";
import { ageBills, averageOpen, creditVolume, daysMetric, openBills, sumPending } from "@/server/analytics/working-capital";
import type { TenantDb } from "@/server/db/tenant";
import { METRICS } from "@/server/metrics/registry";

/**
 * The assistant's only way to read data: a fixed set of read-only tools over the same analytics
 * the pages use. No free SQL. Arguments are validated with Zod; every result carries a templated
 * plain-language summary, used as the answer whenever the language model is unavailable or its
 * answer fails the numeric guard.
 */

export type ToolContext = { db: TenantDb; tenantId: string; domainPack: string };
export type ToolResult = { title: string; summary: string; facts: Record<string, number | string | null>; rows?: Record<string, number | string | null>[] };
export type Tool<S extends z.ZodType = z.ZodType> = { name: string; description: string; args: S; run: (ctx: ToolContext, args: z.infer<S>) => Promise<ToolResult> };
const defineTool = <S extends z.ZodType>(tool: Tool<S>) => tool;

const periodArg = z.enum(["last12", "fy", "prevfy", "all"]).default("last12").describe("last12 = last 12 months, fy = this financial year, prevfy = last financial year, all = all data");
const limitArg = z.number().int().min(1).max(10).default(5);

async function period(ctx: ToolContext, preset: string): Promise<{ period: Period; label: string } | null> {
  const span = await dataSpan(ctx.db);
  if (!span) return null;
  const r = resolvePeriod({ period: preset }, span);
  return { period: r.period, label: `${r.label} (${r.period.from} to ${r.period.to})` };
}
const noData: ToolResult = { title: "No data", summary: "There is no imported data for this business yet.", facts: {} };
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

async function findItem(ctx: ToolContext, text: string) {
  const items = await ctx.db.item.findMany({ where: { OR: [{ name: { contains: text, mode: "insensitive" } }, { sourceKey: { equals: text, mode: "insensitive" } }] }, select: { id: true, name: true, sourceKey: true }, take: 5 });
  return items;
}
async function findParty(ctx: ToolContext, text: string) {
  return ctx.db.party.findMany({ where: { name: { contains: text, mode: "insensitive" } }, select: { id: true, name: true }, take: 5 });
}

const profitOverview = defineTool({
  name: "profit_overview",
  description: "Net sales, gross profit, gross margin, channel fees and contribution for a period, with the best and worst channels.",
  args: z.object({ period: periodArg }),
  run: async (ctx, args) => {
    const p = await period(ctx, args.period);
    if (!p) return noData;
    const [[total], byChannel] = await Promise.all([profitability(ctx.db, ctx.tenantId, p.period, "total"), profitability(ctx.db, ctx.tenantId, p.period, "channel")]);
    if (!total) return { ...noData, summary: `No sales in ${p.label}.` };
    const gm = pct(total.grossProfit, total.netSalesKnownCost);
    const rows = byChannel
      .sort((a, b) => b.netSales.comparedTo(a.netSales))
      .map((r) => ({ channel: channelLabel(r.key), net_sales: round(r.netSales.toNumber()), contribution: round(r.contribution.toNumber()), contribution_pct: pct(r.contribution, r.netSalesKnownCost) }));
    return {
      title: `Profit, ${p.label}`,
      summary: `In ${p.label}, net sales were ${inr(total.netSales.toNumber())}, gross profit ${inr(total.grossProfit.toNumber())} (${formatPct(gm)} margin) and contribution after channel fees ${inr(total.contribution.toNumber())}.${total.costCoverage < 1 ? ` Cost is known for ${(total.costCoverage * 100).toFixed(0)}% of sales, so profit figures are partial.` : ""}`,
      facts: { net_sales: round(total.netSales.toNumber()), gross_profit: round(total.grossProfit.toNumber()), gross_margin_pct: gm, channel_fees: round(total.channelCharges.toNumber()), contribution: round(total.contribution.toNumber()), cost_coverage_pct: round(total.costCoverage * 100, 1) },
      rows
    };
  }
});

const topProducts = defineTool({
  name: "top_products",
  description: "Products ranked by gross profit, net sales or contribution (best or worst), optionally for one channel.",
  args: z.object({ period: periodArg, rank_by: z.enum(["gross_profit", "net_sales", "contribution"]).default("gross_profit"), order: z.enum(["best", "worst"]).default("best"), limit: limitArg, channel: z.string().max(40).optional() }),
  run: async (ctx, args) => {
    const p = await period(ctx, args.period);
    if (!p) return noData;
    const rows = await profitability(ctx.db, ctx.tenantId, p.period, "item", { channel: args.channel });
    const items = new Map((await ctx.db.item.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    const key = { gross_profit: "grossProfit", net_sales: "netSales", contribution: "contribution" }[args.rank_by] as "grossProfit" | "netSales" | "contribution";
    const ranked = rows.sort((a, b) => (args.order === "best" ? b[key].comparedTo(a[key]) : a[key].comparedTo(b[key]))).slice(0, args.limit);
    const out = ranked.map((r) => ({ product: items.get(r.key) ?? "—", net_sales: round(r.netSales.toNumber()), gross_profit: round(r.grossProfit.toNumber()), gross_margin_pct: pct(r.grossProfit, r.netSalesKnownCost), contribution: round(r.contribution.toNumber()) }));
    return {
      title: `${args.order === "best" ? "Top" : "Bottom"} products by ${args.rank_by.replace("_", " ")}, ${p.label}`,
      summary: out.length ? `${args.order === "best" ? "Best" : "Weakest"} by ${args.rank_by.replace("_", " ")}: ${out.map((r) => `${r.product} (${inr(r[args.rank_by])})`).join(", ")}.` : "No product sales in this period.",
      facts: { products: out.length },
      rows: out
    };
  }
});

const productDetail = defineTool({
  name: "product_detail",
  description: "One product by name or code: sales and profit in the last 12 months, stock on hand, days since last sale, forecast weekly demand and items often bought with it.",
  args: z.object({ product: z.string().min(2).max(80) }),
  run: async (ctx, args) => {
    const matches = await findItem(ctx, args.product);
    if (matches.length === 0) return { title: "Product not found", summary: `No product matches "${args.product}".`, facts: {} };
    const item = matches[0];
    const p = await period(ctx, "last12");
    if (!p) return noData;
    const [[profit], positions, forecast, partners] = await Promise.all([
      profitability(ctx.db, ctx.tenantId, p.period, "total", { itemId: item.id }),
      stockPositions(ctx.db, ctx.tenantId, p.period.to),
      ctx.db.forecastPoint.aggregate({ where: { itemId: item.id, modelVersion: { status: "active" } }, _avg: { qty: true } }),
      ctx.db.basketPair.findMany({ where: { itemId: item.id, modelVersion: { status: "active" } }, orderBy: { lift: "desc" }, take: 3 })
    ]);
    const pos = positions.get(item.id);
    const partnerNames = new Map((await ctx.db.item.findMany({ where: { id: { in: partners.map((b) => b.partnerItemId) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    const facts = {
      product: item.name,
      net_sales_12m: profit ? round(profit.netSales.toNumber()) : 0,
      gross_profit_12m: profit ? round(profit.grossProfit.toNumber()) : 0,
      gross_margin_pct: profit ? pct(profit.grossProfit, profit.netSalesKnownCost) : null,
      units_on_hand: pos ? round(pos.qty.toNumber(), 0) : 0,
      stock_value: pos?.value ? round(pos.value.toNumber()) : null,
      days_since_last_sale: pos?.daysSinceLastSale ?? null,
      forecast_units_per_week: forecast._avg.qty === null ? null : round(forecast._avg.qty, 1)
    };
    return {
      title: item.name,
      summary: `${item.name}: ${inr(facts.net_sales_12m)} of sales and ${inr(facts.gross_profit_12m)} gross profit in the last 12 months (${formatPct(facts.gross_margin_pct)}). ${facts.units_on_hand} units in stock${facts.days_since_last_sale !== null ? `, last sold ${facts.days_since_last_sale} days ago` : ""}.${facts.forecast_units_per_week !== null ? ` Forecast about ${facts.forecast_units_per_week} units a week.` : ""}${partners.length ? ` Often bought with ${partners.map((b) => partnerNames.get(b.partnerItemId)).join(", ")}.` : ""}${matches.length > 1 ? ` (Other matches: ${matches.slice(1).map((m) => m.name).join(", ")}.)` : ""}`,
      facts
    };
  }
});

const slowStock = defineTool({
  name: "slow_stock",
  description: "Stock that has not sold for the slow-moving threshold of the trade, largest value first.",
  args: z.object({ limit: limitArg }),
  run: async (ctx, args) => {
    const span = await dataSpan(ctx.db);
    if (!span) return noData;
    const { getDomainPack } = await import("@/domain/packs");
    const days = getDomainPack(ctx.domainPack).thresholds.slowMovingDays;
    const positions = [...(await stockPositions(ctx.db, ctx.tenantId, span.to)).values()].filter((p) => p.qty.gt(0) && (p.daysSinceLastSale ?? Infinity) >= days);
    const items = new Map((await ctx.db.item.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    const total = positions.reduce((s, p) => s + (p.value?.toNumber() ?? 0), 0);
    const rows = positions
      .sort((a, b) => (b.value?.toNumber() ?? 0) - (a.value?.toNumber() ?? 0))
      .slice(0, args.limit)
      .map((p) => ({ product: items.get(p.itemId) ?? "—", value: round(p.value?.toNumber() ?? 0), units: round(p.qty.toNumber(), 0), days_since_last_sale: p.daysSinceLastSale }));
    return {
      title: `Slow-moving stock (no sale for ${days}+ days)`,
      summary: `${positions.length} products have not sold for ${days} days or more, holding ${inr(total)} at cost.${rows.length ? ` Largest: ${rows.map((r) => `${r.product} (${inr(r.value)})`).join(", ")}.` : ""}`,
      facts: { products: positions.length, value: round(total), threshold_days: days },
      rows
    };
  }
});

const expiryRisk = defineTool({
  name: "expiry_risk",
  description: "Batch-tracked stock (pharmacy): expired stock, stock expiring soon, and batches likely to expire before they sell, largest value first.",
  args: z.object({ limit: limitArg }),
  run: async (ctx, args) => {
    const span = await dataSpan(ctx.db);
    if (!span) return noData;
    const { getDomainPack } = await import("@/domain/packs");
    const days = getDomainPack(ctx.domainPack).thresholds.nearExpiryDays ?? 90;
    if (!(await ctx.db.batch.findFirst({ select: { id: true } }))) {
      return { title: "Expiry", summary: "This business's data has no batch numbers or expiry dates, so expiry cannot be reported.", facts: { batches: 0 }, rows: [] };
    }
    const report = await expiryReport(ctx.db, ctx.tenantId, span.to, days);
    const items = new Map((await ctx.db.item.findMany({ select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    const rows = report.batches
      .filter((b) => b.bucket === "expired" || (b.daysToExpiry !== null && b.daysToExpiry <= days && b.atRiskQty > 0))
      .sort((a, b) => (b.bucket === "expired" ? b.value ?? 0 : b.atRiskValue ?? 0) - (a.bucket === "expired" ? a.value ?? 0 : a.atRiskValue ?? 0))
      .slice(0, args.limit)
      .map((b) => ({ product: items.get(b.itemId) ?? "—", batch: b.batchNo, expiry: b.expiryDate, units: round(b.qty, 0), status: b.bucket === "expired" ? "expired" : "likely unsold", value_at_risk: round((b.bucket === "expired" ? b.value : b.atRiskValue) ?? 0) }));
    return {
      title: `Expiry (as of ${span.to})`,
      summary: `Expired stock on hand: ${inr(report.expiredValue)}. Expiring within ${days} days: ${inr(report.nearExpiryValue)}, of which about ${inr(report.atRiskValue)} is not expected to sell in time at the recent sales rate.${rows.length ? ` Largest: ${rows.slice(0, 3).map((r) => `${r.product} batch ${r.batch} (${inr(r.value_at_risk)})`).join(", ")}.` : ""}`,
      facts: { expired_value: round(report.expiredValue), near_expiry_value: round(report.nearExpiryValue), at_risk_value: round(report.atRiskValue), near_expiry_days: days },
      rows
    };
  }
});

const customers = defineTool({
  name: "customer_segments",
  description: "How many named customers are in each segment (champion, loyal, lapsing, ...) and the most valuable customers in one segment.",
  args: z.object({ segment: z.enum(["champion", "loyal", "new", "at_risk", "lapsing", "inactive", "steady"]).default("lapsing"), limit: limitArg }),
  run: async (ctx, args) => {
    const span = await dataSpan(ctx.db);
    if (!span) return noData;
    const rfm = await customerRfm(ctx.db, ctx.tenantId, span.to);
    const names = new Map((await ctx.db.party.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const counts = Object.fromEntries(Object.keys(SEGMENT_LABELS).map((s) => [s, rfm.filter((r) => r.segment === s).length]));
    const rows = rfm
      .filter((r) => r.segment === args.segment)
      .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
      .slice(0, args.limit)
      .map((r) => ({ customer: names.get(r.partyId) ?? "—", lifetime_value: round(r.lifetimeValue), days_since_last_order: r.recencyDays, orders: r.lifetimeOrders }));
    return {
      title: `Customers: ${SEGMENT_LABELS[args.segment].label}`,
      summary: `${counts[args.segment]} customer(s) are ${SEGMENT_LABELS[args.segment].label.toLowerCase()}.${rows.length ? ` Most valuable: ${rows.map((r) => `${r.customer} (${inr(r.lifetime_value)}, ${r.days_since_last_order} days since last order)`).join("; ")}.` : ""}`,
      facts: counts,
      rows
    };
  }
});

const customerDetail = defineTool({
  name: "customer_detail",
  description: "One customer by name: purchases, last order, what they owe, and the predicted chance of an order in the next 60 days.",
  args: z.object({ customer: z.string().min(2).max(80) }),
  run: async (ctx, args) => {
    const matches = await findParty(ctx, args.customer);
    if (matches.length === 0) return { title: "Customer not found", summary: `No customer matches "${args.customer}".`, facts: {} };
    const party = matches[0];
    const span = await dataSpan(ctx.db);
    if (!span) return noData;
    const [rfm, bills, prediction] = await Promise.all([
      customerRfm(ctx.db, ctx.tenantId, span.to),
      openBills(ctx.db, ctx.tenantId, "receivable", span.to),
      ctx.db.prediction.findFirst({ where: { entityId: party.id, modelVersion: { status: "active", model: "repeat_purchase" } } })
    ]);
    const r = rfm.find((x) => x.partyId === party.id);
    const mine = bills.filter((b) => b.partyId === party.id);
    const facts = {
      customer: party.name,
      lifetime_value: r ? round(r.lifetimeValue) : 0,
      orders: r?.lifetimeOrders ?? 0,
      last_order: r?.lastPurchase ?? null,
      days_since_last_order: r?.recencyDays ?? null,
      owes: round(sumPending(mine)),
      overdue: round(sumPending(mine.filter((b) => b.daysOverdue > 0))),
      chance_of_order_60d_pct: prediction ? round(prediction.score * 100, 1) : null
    };
    return {
      title: party.name,
      summary: `${party.name}: ${facts.orders} orders worth ${inr(facts.lifetime_value)}${facts.last_order ? `, last on ${facts.last_order}` : ""}. Owes ${inr(facts.owes)} (${inr(facts.overdue)} overdue).${facts.chance_of_order_60d_pct !== null ? ` Predicted chance of an order in the next 60 days: ${facts.chance_of_order_60d_pct}%.` : ""}${r ? ` Segment: ${SEGMENT_LABELS[r.segment].label}.` : ""}`,
      facts
    };
  }
});

const receivables = defineTool({
  name: "receivables",
  description: "What customers owe today: total, overdue, ageing buckets and the customers with the most overdue.",
  args: z.object({ limit: limitArg }),
  run: async (ctx, args) => {
    const span = await dataSpan(ctx.db);
    if (!span) return noData;
    const bills = await openBills(ctx.db, ctx.tenantId, "receivable", span.to);
    const names = new Map((await ctx.db.party.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const overdueBy = new Map<string, number>();
    for (const b of bills.filter((x) => x.daysOverdue > 0)) overdueBy.set(b.partyId, (overdueBy.get(b.partyId) ?? 0) + b.pending);
    const rows = [...overdueBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, args.limit).map(([id, v]) => ({ customer: names.get(id) ?? "—", overdue: round(v) }));
    const total = sumPending(bills);
    const overdue = sumPending(bills.filter((b) => b.daysOverdue > 0));
    return {
      title: `Receivables on ${span.to}`,
      summary: `Customers owe ${inr(total)}, of which ${inr(overdue)} is overdue.${rows.length ? ` Most overdue: ${rows.map((r) => `${r.customer} (${inr(r.overdue)})`).join(", ")}.` : ""}`,
      facts: { total: round(total), overdue: round(overdue), ...Object.fromEntries(ageBills(bills).map((a) => [a.label, round(a.amount)])) },
      rows
    };
  }
});

const cashCycle = defineTool({
  name: "cash_cycle",
  description: "Days to collect from customers (DSO) and days to pay suppliers (DPO) for a period.",
  args: z.object({ period: periodArg }),
  run: async (ctx, args) => {
    const p = await period(ctx, args.period);
    if (!p) return noData;
    const days = Math.round((Date.parse(p.period.to) - Date.parse(p.period.from)) / 86_400_000) + 1;
    const [ar, ap, sales, purchases] = await Promise.all([
      averageOpen(ctx.db, ctx.tenantId, "receivable", p.period),
      averageOpen(ctx.db, ctx.tenantId, "payable", p.period),
      creditVolume(ctx.db, ctx.tenantId, "receivable", p.period),
      creditVolume(ctx.db, ctx.tenantId, "payable", p.period)
    ]);
    const dso = daysMetric(ar.value, sales, days, "credit sales").value;
    const dpo = daysMetric(ap.value, purchases, days, "credit purchases").value;
    return {
      title: `Cash cycle, ${p.label}`,
      summary: `In ${p.label}, customers took ${dso ?? "—"} days to pay on average and you took ${dpo ?? "—"} days to pay suppliers.`,
      facts: { dso_days: dso, dpo_days: dpo, average_receivables: round(ar.value), average_payables: round(ap.value) }
    };
  }
});

const openFindings = defineTool({
  name: "open_findings",
  description: "The open recommendations (problems and opportunities) found in the books, largest estimated impact first.",
  args: z.object({ limit: limitArg }),
  run: async (ctx, args) => {
    const findings = await ctx.db.finding.findMany({ where: { status: "open" }, orderBy: { impactInr: { sort: "desc", nulls: "last" } }, take: args.limit });
    const rows = findings.map((f) => ({ title: f.title, estimated_impact: f.impactInr ? round(f.impactInr.toNumber()) : null, suggested_action: f.suggestedAction }));
    return {
      title: "Open recommendations",
      summary: rows.length ? rows.map((r, i) => `${i + 1}. ${r.title}${r.estimated_impact !== null ? ` (estimated ${inr(r.estimated_impact)})` : ""}`).join(" ") : "No open recommendations.",
      facts: { open: await ctx.db.finding.count({ where: { status: "open" } }) },
      rows
    };
  }
});

const channels = defineTool({
  name: "channel_performance",
  description: "Each sales channel's net sales and contribution after marketplace fees, payout lag, fill rate on purchase orders and buyer concentration.",
  args: z.object({ period: periodArg }),
  run: async (ctx, args) => {
    const p = await period(ctx, args.period);
    if (!p) return noData;
    const [rows, lag, fill, totals, conc] = await Promise.all([
      profitability(ctx.db, ctx.tenantId, p.period, "channel"),
      payoutLag(ctx.db, ctx.tenantId, p.period),
      fillRate(ctx.db, ctx.tenantId, p.period, "channel"),
      chargeTotals(ctx.db, ctx.tenantId, p.period),
      concentration(ctx.db, ctx.tenantId, p.period)
    ]);
    const out = rows
      .sort((a, b) => b.netSales.comparedTo(a.netSales))
      .map((r) => ({
        channel: channelLabel(r.key),
        net_sales: round(r.netSales.toNumber()),
        contribution: round(r.contribution.toNumber()),
        contribution_pct: pct(r.contribution, r.netSalesKnownCost),
        payout_days_median: lag.find((l) => l.channel === r.key)?.medianDays ?? null,
        fill_rate_pct: (() => {
          const f = fill.find((x) => x.key === r.key);
          return f?.fillRate == null ? null : round(f.fillRate * 100, 1);
        })()
      }));
    const losing = out.filter((r) => r.contribution < 0);
    return {
      title: `Channels, ${p.label}`,
      summary: `${out.map((r) => `${r.channel}: ${inr(r.net_sales)} sales, ${formatPct(r.contribution_pct)} contribution`).join("; ")}.${losing.length ? ` Losing money after fees: ${losing.map((r) => r.channel).join(", ")}.` : ""}`,
      facts: { tax_withheld: round(totals.reduce((s, t) => s + t.taxWithheld, 0)), top5_buyers_share_pct: conc.top5Share === null ? null : round(conc.top5Share * 100, 1) },
      rows: out
    };
  }
});

const metricDefinition = defineTool({
  name: "metric_definition",
  description: "How a metric is defined and calculated (e.g. gross margin, DSO, fill rate, contribution).",
  args: z.object({ metric: z.string().min(2).max(60) }),
  run: async (_ctx, args): Promise<ToolResult> => {
    const q = args.metric.toLowerCase();
    const m = METRICS.find((x) => x.id === q.replace(/\s+/g, "_") || x.label.toLowerCase() === q) ?? METRICS.find((x) => x.label.toLowerCase().includes(q) || x.id.includes(q.replace(/\s+/g, "_")));
    if (!m) return { title: "Unknown metric", summary: `No metric called "${args.metric}". See the Definitions page.`, facts: {} };
    return { title: m.label, summary: `${m.label}: ${m.formula}${m.notes ? ` ${m.notes}` : ""}`, facts: { metric: m.id, unit: m.unit } };
  }
});

export const TOOLS: Tool<any>[] = [profitOverview, topProducts, productDetail, slowStock, expiryRisk, customers, customerDetail, receivables, cashCycle, openFindings, channels, metricDefinition];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** OpenAI-compatible tool definitions (JSON Schema generated from the Zod schemas). */
export function toolDefinitions() {
  return TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.args, { io: "input" }) } }));
}

export class ToolArgsError extends Error {}

/** Validates arguments from the model and runs the tool. Unknown tools and bad arguments are refused. */
export async function runTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolResult> {
  const tool = toolByName(name);
  if (!tool) throw new ToolArgsError(`Unknown tool ${name}`);
  const parsed = tool.args.safeParse(rawArgs ?? {});
  if (!parsed.success) throw new ToolArgsError(`Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return tool.run(ctx, parsed.data);
}
