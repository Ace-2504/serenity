import { formatInrCompact as inr } from "@/components/bi/format";
import { channelLabel } from "@/server/analytics/context";
import { SEGMENT_LABELS } from "@/server/analytics/customers";
import { pct, type ProfitRow } from "@/server/analytics/profitability";
import type { RuleContext } from "@/server/findings/context";
import { RULE_CONFIG as C, severityFor, type FindingDraft } from "@/server/findings/types";

/**
 * Deterministic recommendation rules. Each reads only the precomputed context, so the same data
 * always yields the same findings. Text is templated, never generated: these are "measured"
 * findings. Impact estimates state their formula and assumptions.
 */

const p1 = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const MARKETPLACES = new Set(["amazon", "meesho", "own_web"]);

export const RULES: { id: string; label: string; run: (ctx: RuleContext) => FindingDraft[] }[] = [
  { id: "SLOW_MOVER_CAPITAL", label: "Cash tied up in slow-moving stock", run: slowMovers },
  { id: "MARGIN_EROSION", label: "Gross margin falling in a product group", run: marginErosion },
  { id: "DISCOUNT_LEAKAGE", label: "Discounts rising in a product group", run: discountLeakage },
  { id: "COLLECTIONS_SLOWING", label: "Customers paying more slowly", run: collectionsSlowing },
  { id: "CUSTOMER_CONCENTRATION", label: "Dependence on a few buyers", run: customerConcentration },
  { id: "LAPSING_KEY_CUSTOMER", label: "Valuable customer has gone quiet", run: lapsingCustomers },
  { id: "STOCKOUT_REPEAT", label: "Repeated stockouts losing sales", run: stockouts },
  { id: "CHANNEL_LOSS_MAKER", label: "Product loses money on a channel", run: channelLossMakers },
  { id: "FILL_RATE_LOW", label: "Supplying less than a platform ordered", run: lowFillRate },
  { id: "EXPIRED_STOCK", label: "Expired stock still on hand", run: expiredStock },
  { id: "NEAR_EXPIRY_AT_RISK", label: "Stock likely to expire before it sells", run: nearExpiry }
];

function slowMovers(ctx: RuleContext): FindingDraft[] {
  const days = ctx.pack.thresholds.slowMovingDays;
  return [...ctx.positions.values()]
    .filter((p) => p.qty.gt(0) && p.value !== null && p.value.toNumber() >= C.slowMoverMinValue && (p.daysSinceLastSale ?? Infinity) >= days)
    .sort((a, b) => b.value!.toNumber() - a.value!.toNumber())
    .slice(0, C.slowMoverMaxFindings)
    .map((p) => {
      const item = ctx.items.get(p.itemId)!;
      const value = p.value!.toNumber();
      const buyers = (ctx.pastBuyers.get(p.itemId) ?? []).slice(0, 5);
      const idle = p.daysSinceLastSale === null ? "has never sold" : `has not sold for ${p.daysSinceLastSale} days`;
      return {
        ruleId: "SLOW_MOVER_CAPITAL",
        dedupeKey: `SLOW_MOVER_CAPITAL|${p.itemId}`,
        entityType: "item",
        entityId: p.itemId,
        entityLabel: item.name,
        severity: severityFor(value),
        title: `${inr(value)} is tied up in ${item.name}, which ${idle}`,
        whatHappened: `${p.qty.toFixed()} units are in stock at a cost of ${inr(value)}. The item ${idle}${p.lastSaleDate ? ` (last sale ${p.lastSaleDate})` : ""}.`,
        evidence: {
          facts: [
            { label: "Units on hand", value: p.qty.toFixed() },
            { label: "Value at cost", value: inr(value) },
            { label: "Days since last sale", value: p.daysSinceLastSale === null ? "never sold" : String(p.daysSinceLastSale) },
            { label: "Slow-moving threshold", value: `${days} days` }
          ],
          table: buyers.length
            ? { columns: ["Customers who bought it before", "Units bought"], rows: buyers.map((b) => [ctx.parties.get(b.partyId)?.name ?? "—", String(Math.round(b.qty))]) }
            : undefined
        },
        whyItMatters: `This cash cannot be used for stock that sells. Stock that sits also risks damage, obsolescence and storage cost.`,
        suggestedAction: `Stop reordering it. Offer it to customers who bought it before${buyers.length ? ` (${buyers.slice(0, 3).map((b) => ctx.parties.get(b.partyId)?.name).join(", ")})` : ""}, bundle it with fast sellers, or ask the supplier about a return or exchange.`,
        impactInr: value,
        impactFormula: "Cash tied up = units on hand × weighted-average cost",
        assumptions: [
          "Recovering this cash requires selling or returning the stock; a clearance price will recover less than cost.",
          "Days since last sale counts sales invoices only."
        ],
        measurePlan: { metric: "item_stock_value", label: "Stock value of this item", baseline: value, checkAfterDays: 60, successWhen: "falls by at least half", target: value / 2, direction: "decrease" }
      } satisfies FindingDraft;
    });
}

function groupPair(ctx: RuleContext) {
  const then = new Map(ctx.groupThen.map((g) => [g.key, g]));
  return ctx.groupNow
    .map((now) => ({ now, then: then.get(now.key), name: ctx.groupName.get(now.key) ?? "Ungrouped" }))
    .filter((g): g is { now: ProfitRow; then: ProfitRow; name: string } => g.then !== undefined && g.now.netSalesKnownCost.toNumber() >= C.minGroupSales && g.then.netSalesKnownCost.gt(0));
}

function marginErosion(ctx: RuleContext): FindingDraft[] {
  const { current, lastYear } = ctx.periods;
  return groupPair(ctx).flatMap(({ now, then, name }) => {
    const gmNow = pct(now.grossProfit, now.netSalesKnownCost)!;
    const gmThen = pct(then.grossProfit, then.netSalesKnownCost)!;
    if (gmThen - gmNow < C.marginDropPp) return [];
    const discNow = pct(now.discounts, now.grossSales) ?? 0;
    const discThen = pct(then.discounts, then.grossSales) ?? 0;
    const cost = ctx.purchaseCost.get(now.key);
    const costChange = cost?.now && cost?.then ? ((cost.now - cost.then) / cost.then) * 100 : null;
    const annualSales = now.netSalesKnownCost.toNumber() * (365 / C.windowDays);
    const impact = ((gmThen - gmNow) / 100) * annualSales;
    const causes = [
      costChange !== null && costChange > 3 ? `purchase cost per unit is up ${costChange.toFixed(0)}%` : null,
      discNow - discThen > 1 ? `discounts are up ${(discNow - discThen).toFixed(1)} points` : null
    ].filter(Boolean);
    return [
      {
        ruleId: "MARGIN_EROSION",
        dedupeKey: `MARGIN_EROSION|${now.key}`,
        entityType: "item_group",
        entityId: now.key,
        entityLabel: name,
        severity: severityFor(impact),
        title: `${name}: gross margin fell from ${p1(gmThen)} to ${p1(gmNow)}`,
        whatHappened: `In the last ${C.windowDays} days ${name} earned ${p1(gmNow)} gross margin on ${inr(now.netSalesKnownCost.toNumber())} of sales, against ${p1(gmThen)} in the same period last year.${causes.length ? ` Likely causes: ${causes.join("; ")}.` : ""}`,
        evidence: {
          facts: [
            { label: `Gross margin, ${current.from} to ${current.to}`, value: p1(gmNow) },
            { label: `Gross margin, ${lastYear.from} to ${lastYear.to}`, value: p1(gmThen) },
            { label: "Discount rate now / last year", value: `${p1(discNow)} / ${p1(discThen)}` },
            { label: "Average purchase cost per unit change", value: costChange === null ? "not enough purchases to compare" : `${costChange >= 0 ? "+" : ""}${costChange.toFixed(1)}%` }
          ]
        },
        whyItMatters: `At this sales level the lower margin costs about ${inr(impact)} of gross profit a year.`,
        suggestedAction: `Check whether supplier prices rose without a matching selling-price revision; renegotiate or raise prices for ${name}. Review discounts given on this group.`,
        impactInr: impact,
        impactFormula: `Margin points lost × net sales of the last ${C.windowDays} days × 365/${C.windowDays}`,
        assumptions: ["Compares the same calendar window a year apart, so seasonality is largely removed.", "Annualises the last 90 days of sales; volumes may change.", "Purchase cost change is an average per unit and includes product-mix effects."],
        measurePlan: { metric: "group_gross_margin", label: `Gross margin of ${name} over the next 90 days`, baseline: gmNow, checkAfterDays: 90, successWhen: `returns to at least ${p1(gmThen - 2)}`, target: gmThen - 2, direction: "increase" }
      } satisfies FindingDraft
    ];
  });
}

function discountLeakage(ctx: RuleContext): FindingDraft[] {
  return groupPair(ctx).flatMap(({ now, then, name }) => {
    const discNow = pct(now.discounts, now.grossSales) ?? 0;
    const discThen = pct(then.discounts, then.grossSales) ?? 0;
    if (discNow - discThen < C.discountRisePp) return [];
    const impact = ((discNow - discThen) / 100) * now.grossSales.toNumber() * (365 / C.windowDays);
    return [
      {
        ruleId: "DISCOUNT_LEAKAGE",
        dedupeKey: `DISCOUNT_LEAKAGE|${now.key}`,
        entityType: "item_group",
        entityId: now.key,
        entityLabel: name,
        severity: severityFor(impact),
        title: `${name}: discounts rose from ${p1(discThen)} to ${p1(discNow)} of gross sales`,
        whatHappened: `Discounts on ${name} were ${inr(now.discounts.toNumber())} on ${inr(now.grossSales.toNumber())} of gross sales in the last ${C.windowDays} days, ${(discNow - discThen).toFixed(1)} points more than in the same period last year.`,
        evidence: {
          facts: [
            { label: "Discount rate now", value: p1(discNow) },
            { label: "Discount rate same period last year", value: p1(discThen) },
            { label: "Gross margin now / last year", value: `${p1(pct(now.grossProfit, now.netSalesKnownCost))} / ${p1(pct(then.grossProfit, then.netSalesKnownCost))}` }
          ]
        },
        whyItMatters: `If the extra discount did not bring extra volume, it costs about ${inr(impact)} a year.`,
        suggestedAction: `Review who is getting the larger discounts on ${name} and whether they buy more because of them; set a discount ceiling for this group.`,
        impactInr: impact,
        impactFormula: `Discount points added × gross sales of the last ${C.windowDays} days × 365/${C.windowDays}`,
        assumptions: ["Assumes the extra discount did not create the sales it applies to.", "Annualises the last 90 days."],
        measurePlan: { metric: "group_discount_rate", label: `Discount rate on ${name} over the next 90 days`, baseline: discNow, checkAfterDays: 90, successWhen: `falls to ${p1(discThen + 0.5)} or less`, target: discThen + 0.5, direction: "decrease" }
      } satisfies FindingDraft
    ];
  });
}

function collectionsSlowing(ctx: RuleContext): FindingDraft[] {
  const { now, then, arNow } = ctx.dso;
  const halfDays = 182;
  const slower = [...ctx.paymentDelays.entries()]
    .filter(([, d]) => d.now && d.then && d.now.n >= 3 && d.then.n >= 3 && d.now.delay - d.then.delay >= C.payerDelayRiseDays)
    .map(([partyId, d]) => {
      const owed = ctx.receivables.filter((b) => b.partyId === partyId).reduce((s, b) => s + b.pending, 0);
      // Cash held back = their credit sales per day x the extra days they now take.
      const heldBack = (d.now!.amount / halfDays) * (d.now!.delay - d.then!.delay);
      return { partyId, before: d.then!.delay, after: d.now!.delay, owed, heldBack, n: d.now!.n };
    })
    .sort((a, b) => b.heldBack - a.heldBack);
  const dsoRose = now.value !== null && then.value !== null && now.value - then.value >= C.dsoRiseDays;
  if (!dsoRose && slower.length === 0) return [];
  const impact = dsoRose ? arNow * (1 - then.value! / now.value!) : slower.reduce((s, x) => s + x.heldBack, 0);
  const listed = slower.slice(0, 15);
  const avg = (key: "before" | "after") => listed.reduce((s, x) => s + x[key] * x.n, 0) / Math.max(1, listed.reduce((s, x) => s + x.n, 0));
  return [
    {
      ruleId: "COLLECTIONS_SLOWING",
      dedupeKey: "COLLECTIONS_SLOWING|business",
      entityType: "business",
      entityId: null,
      entityLabel: "Customers paying late",
      severity: severityFor(impact),
      title: dsoRose
        ? `Customers now take ${now.value} days to pay, up from ${then.value}`
        : `${slower.length} customer${slower.length === 1 ? " is" : "s are"} paying at least ${C.payerDelayRiseDays} days later than last year`,
      whatHappened: `${slower.length} customer(s) now settle invoices on average ${Math.round(avg("after"))} days after the due date, against ${Math.round(avg("before"))} days for invoices due in the same months last year. Across all customers, days to collect is ${now.value ?? "—"} days against ${then.value ?? "—"} last year.`,
      evidence: {
        facts: [
          { label: "Days to collect, last 6 months", value: now.value === null ? "—" : `${now.value} days` },
          { label: "Days to collect, same months last year", value: then.value === null ? "—" : `${then.value} days` },
          { label: "Receivables now", value: inr(arNow) },
          { label: "Customers paying later", value: String(slower.length) }
        ],
        table: listed.length
          ? {
              columns: ["Customer", "Avg days late, last year", "Avg days late, now", "Owes now", "Cash held back"],
              rows: listed.map((s) => [ctx.parties.get(s.partyId)?.name ?? "—", s.before.toFixed(0), s.after.toFixed(0), inr(s.owed), inr(s.heldBack)])
            }
          : undefined
      },
      whyItMatters: `Slower payment keeps about ${inr(impact)} of your cash with customers, which you then fund from your own pocket or borrowing.`,
      suggestedAction: `Call the customers listed, largest first; agree payment dates and hold further credit for anyone more than 60 days overdue. Consider a small early-payment discount only if it costs less than your borrowing.`,
      impactInr: impact,
      impactFormula: dsoRose
        ? "Receivables now × (1 − last year's days to collect ÷ current days to collect)"
        : "Σ over listed customers: invoiced in the last 6 months ÷ 182 × extra days late",
      assumptions: ["Assumes sales to these customers stay at the current level.", "Days late is measured on fully paid invoices, from the due date to the final receipt, for invoices due in each period."],
      measurePlan: {
        metric: "payer_delay",
        label: "Average days late of the listed customers, for invoices due in the next 60 days",
        baseline: avg("after"),
        checkAfterDays: 60,
        successWhen: `falls to ${Math.round(avg("before") + 5)} days or less`,
        target: avg("before") + 5,
        direction: "decrease",
        subjects: listed.map((s) => s.partyId)
      }
    }
  ];
}

function customerConcentration(ctx: RuleContext): FindingDraft[] {
  const c = ctx.concentration;
  const top = c.top[0];
  if (!top || c.buyers < C.concentrationMinBuyers || ((c.top5Share ?? 0) < C.concentrationTop5 && top.share < C.concentrationSingle)) return [];
  const name = ctx.parties.get(top.partyId)?.name ?? "—";
  return [
    {
      ruleId: "CUSTOMER_CONCENTRATION",
      dedupeKey: "CUSTOMER_CONCENTRATION|business",
      entityType: "business",
      entityId: null,
      entityLabel: "Buyer base",
      severity: "medium",
      title: `${p1((c.top5Share ?? 0) * 100)} of sales come from just five buyers`,
      whatHappened: `Over the last 12 months the five largest buyers took ${p1((c.top5Share ?? 0) * 100)} of net sales; the largest, ${name}, took ${p1(top.share * 100)}.`,
      evidence: { facts: [{ label: "Top 5 share", value: p1((c.top5Share ?? 0) * 100) }, { label: "Largest buyer", value: `${name}: ${p1(top.share * 100)}` }, { label: "HHI", value: String(c.hhi) }], table: { columns: ["Buyer", "Share of net sales"], rows: c.top.slice(0, 5).map((t) => [ctx.parties.get(t.partyId)?.name ?? "—", p1(t.share * 100)]) } },
      whyItMatters: `Losing or renegotiating with one of these buyers would hit sales and margin hard, and they have bargaining power over your prices and credit terms.`,
      suggestedAction: `Grow the next tier of customers (see the Loyal and Steady segments) and avoid extending more credit to the largest buyers than to others.`,
      impactInr: null,
      impactFormula: "A risk, not a cost: no rupee estimate is made",
      assumptions: ["Marketplaces and quick-commerce platforms count as one buyer each."],
      measurePlan: { metric: "top5_share", label: "Top-5 buyers' share over the next 12 months", baseline: (c.top5Share ?? 0) * 100, checkAfterDays: 180, successWhen: "falls by at least 5 points", target: (c.top5Share ?? 0) * 100 - 5, direction: "decrease" }
    }
  ];
}

function lapsingCustomers(ctx: RuleContext): FindingDraft[] {
  const margin = ctx.businessMargin;
  return ctx.rfm
    .filter((c) => c.segment === "lapsing")
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
    .slice(0, C.lapsingMaxFindings)
    .map((c) => {
      const party = ctx.parties.get(c.partyId);
      const years = Math.max(1, (Date.parse(c.lastPurchase) - Date.parse(c.firstPurchase)) / (365.25 * 86_400_000));
      const annual = c.lifetimeValue / years;
      const impact = margin === null ? null : annual * margin;
      const school = party?.segmentTag === "school";
      return {
        ruleId: "LAPSING_KEY_CUSTOMER",
        dedupeKey: `LAPSING_KEY_CUSTOMER|${c.partyId}`,
        entityType: "party",
        entityId: c.partyId,
        entityLabel: party?.name ?? "—",
        severity: severityFor(impact),
        title: `${party?.name ?? "A customer"} has not ordered for ${c.recencyDays} days`,
        whatHappened: `${party?.name} usually orders every ${Math.round(c.usualGapDays ?? 0)} days and has placed ${c.lifetimeOrders} orders worth ${inr(c.lifetimeValue)}. The last order was on ${c.lastPurchase}; by their own buying pattern about ${c.expectedOrdersInSilence.toFixed(1)} more orders would have been expected by now.`,
        evidence: {
          facts: [
            { label: "Last order", value: c.lastPurchase },
            { label: "Days silent / usual gap", value: `${c.recencyDays} / ${Math.round(c.usualGapDays ?? 0)} days` },
            { label: "Orders expected since the silence became unusual", value: c.expectedOrdersInSilence.toFixed(1) },
            { label: "Lifetime orders / value", value: `${c.lifetimeOrders} / ${inr(c.lifetimeValue)}` },
            { label: "Segment", value: SEGMENT_LABELS[c.segment].label }
          ]
        },
        whyItMatters: impact === null ? `They have bought about ${inr(annual)} a year.` : `They have bought about ${inr(annual)} a year, worth about ${inr(impact)} of gross profit.`,
        suggestedAction: school
          ? `Call before the next school term; send the catalogue for the items they bought last season with a back-to-school offer.`
          : `Call to find out why: a competitor, a service problem, or a credit hold. Offer to restock what they usually buy.`,
        impactInr: impact,
        impactFormula: "Average yearly purchases × business gross margin (last 12 months)",
        assumptions: ["Assumes the customer would keep buying at their historical yearly average.", "The 'expected orders' figure comes from their own purchases by calendar month, so seasonal pauses are allowed for."],
        measurePlan: { metric: "customer_orders", label: "Orders from this customer in the next 45 days", baseline: 0, checkAfterDays: 45, successWhen: "at least one order", target: 1, direction: "increase" }
      } satisfies FindingDraft;
    });
}

function stockouts(ctx: RuleContext): FindingDraft[] {
  const sales = new Map(ctx.itemYear.map((r) => [r.key, r]));
  return [...ctx.stockoutsYear.entries()]
    .filter(([, days]) => days >= C.stockoutMinDays)
    .flatMap(([itemId, days]) => {
      const row = sales.get(itemId);
      const item = ctx.items.get(itemId);
      if (!row || !item || row.unitsSold.lte(0)) return [];
      const inStockDays = Math.max(1, 365 - days);
      const dailyUnits = row.unitsSold.toNumber() / inStockDays;
      const gpPerUnit = row.netSalesKnownCost.gt(0) ? row.grossProfit.toNumber() / row.unitsSold.toNumber() : null;
      const lostUnits = dailyUnits * days;
      const impact = gpPerUnit === null ? null : lostUnits * gpPerUnit;
      const reorderPoint = Math.ceil(dailyUnits * C.replenishmentDays * 1.3);
      const per90 = Math.round((days * 90) / 365);
      return [
        {
          ruleId: "STOCKOUT_REPEAT",
          dedupeKey: `STOCKOUT_REPEAT|${itemId}`,
          entityType: "item",
          entityId: itemId,
          entityLabel: item.name,
          severity: severityFor(impact),
          title: `${item.name} was out of stock on ${days} days in the last year`,
          whatHappened: `${item.name} sold about ${dailyUnits.toFixed(1)} units a day when in stock, but had none on ${days} of the last 365 days, while customers were still buying it.`,
          evidence: {
            facts: [
              { label: "Days out of stock (last 365)", value: String(days) },
              { label: "Units sold per in-stock day", value: dailyUnits.toFixed(1) },
              { label: "Estimated units missed", value: Math.round(lostUnits).toString() },
              { label: "Suggested reorder point", value: `${reorderPoint} units` }
            ]
          },
          whyItMatters: impact === null ? "Customers who find it out of stock may buy elsewhere." : `Missed sales cost about ${inr(impact)} of gross profit in the last year, and customers who find it out of stock may switch suppliers.`,
          suggestedAction: `Reorder when stock falls to about ${reorderPoint} units (≈ ${C.replenishmentDays} days of demand plus a 30% buffer), or agree a shorter lead time with the supplier.`,
          impactInr: impact,
          impactFormula: "Units/day when in stock × stockout days × gross profit per unit (last 365 days)",
          assumptions: [`Assumes demand on stockout days matched demand on in-stock days.`, `Reorder point assumes about ${C.replenishmentDays} days from order to receipt; set your supplier's actual lead time.`],
          measurePlan: { metric: "item_stockout_days", label: "Stockout days in the next 90 days", baseline: per90, checkAfterDays: 90, successWhen: "3 days or fewer", target: 3, direction: "decrease" }
        } satisfies FindingDraft
      ];
    });
}

function channelLossMakers(ctx: RuleContext): FindingDraft[] {
  return ctx.channelItemYear
    .map((r) => {
      const [channel, itemId] = r.key.split("|");
      return { r, channel, itemId };
    })
    .filter(({ r, channel }) => MARKETPLACES.has(channel) && r.contribution.lt(0) && r.invoices >= C.channelLossMinInvoices && r.unitsSold.gt(0))
    .sort((a, b) => a.r.contribution.comparedTo(b.r.contribution))
    .slice(0, C.channelLossMaxFindings)
    .map(({ r, channel, itemId }) => {
      const item = ctx.items.get(itemId)!;
      const loss = -r.contribution.toNumber();
      const perUnit = loss / r.unitsSold.toNumber();
      return {
        ruleId: "CHANNEL_LOSS_MAKER",
        dedupeKey: `CHANNEL_LOSS_MAKER|${channel}|${itemId}`,
        entityType: "channel_item",
        entityId: itemId,
        entityLabel: `${item.name} on ${channelLabel(channel)}`,
        severity: severityFor(loss, 25_000, 5_000),
        title: `${item.name} loses ${inr(loss)} a year on ${channelLabel(channel)} after fees`,
        whatHappened: `In the last 12 months ${item.name} made ${inr(r.grossProfit.toNumber())} gross profit on ${channelLabel(channel)} but the channel charged ${inr(r.channelCharges.toNumber())} in fees, leaving ${inr(r.contribution.toNumber())}.`,
        evidence: {
          facts: [
            { label: "Net sales on channel", value: inr(r.netSales.toNumber()) },
            { label: "Gross margin", value: p1(pct(r.grossProfit, r.netSalesKnownCost)) },
            { label: "Channel fees", value: inr(r.channelCharges.toNumber()) },
            { label: "Contribution", value: inr(r.contribution.toNumber()) },
            { label: "Orders / units", value: `${r.invoices} / ${r.unitsSold.toFixed()}` }
          ]
        },
        whyItMatters: `Every unit sold here loses about ${inr(perUnit)} once shipping and fees are paid; more sales make it worse.`,
        suggestedAction: `Raise the ${channelLabel(channel)} price by at least ${inr(perUnit)} per unit, sell it only in multi-packs so fixed fees are spread, or stop listing it there and sell it through channels where it earns.`,
        impactInr: loss,
        impactFormula: "−(gross profit − channel fees) over the last 12 months",
        assumptions: ["Fees are spread over an order's products by value; fixed per-order fees weigh most on cheap items.", "GST on fees and tax withheld (TCS/TDS) are excluded as credits."],
        measurePlan: { metric: "channel_item_contribution", label: `Contribution per unit of this product on ${channelLabel(channel)} over the next 90 days`, baseline: -perUnit, checkAfterDays: 90, successWhen: "is zero or positive", target: 0, direction: "increase" }
      } satisfies FindingDraft;
    });
}

function lowFillRate(ctx: RuleContext): FindingDraft[] {
  const margin = ctx.businessMargin;
  return ctx.fillByChannel
    .filter((c) => c.fillRate !== null && c.fillRate < C.fillRateTarget && c.ordered >= C.fillRateMinUnits)
    .map((c) => {
      const label = channelLabel(c.key);
      const items = ctx.fillByChannelItem
        .filter((r) => r.key.startsWith(`${c.key}|`) && r.ordered > r.supplied)
        .sort((a, b) => (b.shortValue ?? 0) - (a.shortValue ?? 0) || b.ordered - b.supplied - (a.ordered - a.supplied));
      const shortUnits = c.ordered - c.supplied;
      const impact = c.shortValue !== null && margin !== null ? c.shortValue * margin * (365 / C.windowDays) : null;
      const pctNow = (c.fillRate! * 100).toFixed(1);
      return {
        ruleId: "FILL_RATE_LOW",
        dedupeKey: `FILL_RATE_LOW|${c.key}`,
        entityType: "business",
        entityId: null,
        entityLabel: label,
        severity: severityFor(impact),
        title: `${label}: you supplied ${pctNow}% of what was ordered in the last ${C.windowDays} days`,
        whatHappened: `${label} ordered ${Math.round(c.ordered)} units on ${c.pos} purchase orders and received ${Math.round(c.supplied)}; ${c.shortLines} PO line(s) were short by ${Math.round(shortUnits)} units in all.`,
        evidence: {
          facts: [
            { label: "Fill rate, last 90 days", value: `${pctNow}%` },
            { label: "Units ordered / supplied", value: `${Math.round(c.ordered)} / ${Math.round(c.supplied)}` },
            { label: "Short value at PO prices", value: c.shortValue === null ? "PO prices not given" : inr(c.shortValue) },
            { label: "Target", value: `${(C.fillRateTarget * 100).toFixed(0)}%` }
          ],
          table: items.length
            ? {
                columns: ["Product", "Ordered", "Supplied", "Fill rate", "Short value"],
                rows: items.slice(0, 15).map((r) => [
                  ctx.items.get(r.key.split("|")[1])?.name ?? "—",
                  String(Math.round(r.ordered)),
                  String(Math.round(r.supplied)),
                  r.fillRate === null ? "—" : `${(r.fillRate * 100).toFixed(0)}%`,
                  r.shortValue === null ? "—" : inr(r.shortValue)
                ])
              }
            : undefined
        },
        whyItMatters: `Quick-commerce platforms reduce orders, delist products or debit penalties for short supply.${impact === null ? "" : ` The missed sales alone are worth about ${inr(impact)} of gross profit a year.`}`,
        suggestedAction: `Keep a separate stock buffer for ${label}'s top products, check the reorder points of the products listed, and tell the platform early when a PO cannot be met in full.`,
        impactInr: impact,
        impactFormula: "Short value at PO prices × business gross margin × 365/90",
        assumptions: [
          "Assumes the short units would have sold at the PO price and the business's average margin.",
          "Penalties or fill-rate debits are not included unless imported as channel charges."
        ],
        measurePlan: { metric: "channel_fill_rate", label: `${label} fill rate over the next 90 days`, baseline: c.fillRate! * 100, checkAfterDays: 90, successWhen: `reaches ${(C.fillRateTarget * 100).toFixed(0)}%`, target: C.fillRateTarget * 100, direction: "increase" }
      } satisfies FindingDraft;
    });
}

function batchTable(ctx: RuleContext, batches: NonNullable<RuleContext["expiry"]>["batches"], qty: (b: (typeof batches)[number]) => number, value: (b: (typeof batches)[number]) => number | null) {
  return {
    columns: ["Item", "Batch", "Expiry", "Units", "Value at cost"],
    rows: batches.map((b) => [ctx.items.get(b.itemId)?.name ?? "—", b.batchNo, b.expiryDate ?? "—", String(Math.round(qty(b))), value(b) === null ? "unknown cost" : inr(value(b)!)])
  };
}

function expiredStock(ctx: RuleContext): FindingDraft[] {
  const expired = (ctx.expiry?.batches ?? []).filter((b) => b.bucket === "expired");
  const value = expired.reduce((s, b) => s + (b.value ?? 0), 0);
  if (value < C.expiredMinValue) return [];
  const top = [...expired].sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 10);
  return [
    {
      ruleId: "EXPIRED_STOCK",
      dedupeKey: "EXPIRED_STOCK|business",
      entityType: "business",
      entityId: null,
      entityLabel: "Whole business",
      severity: severityFor(value, 50_000, 10_000),
      title: `${inr(value)} of expired stock is still on hand (${expired.length} batch${expired.length === 1 ? "" : "es"})`,
      whatHappened: `${expired.length} batch${expired.length === 1 ? " has" : "es have"} passed expiry with ${Math.round(expired.reduce((s, b) => s + b.qty, 0))} units still in stock, worth ${inr(value)} at cost.`,
      evidence: { facts: [{ label: "Expired batches", value: String(expired.length) }, { label: "Value at cost", value: inr(value) }, { label: "As of", value: ctx.asOf }], table: batchTable(ctx, top, (b) => b.qty, (b) => b.value) },
      whyItMatters: "Expired medicines must not be sold or dispensed. Unless the distributor takes them back for credit, their cost is a loss, and keeping them on the shelf risks selling one by mistake.",
      suggestedAction:
        "Move these packs out of saleable stock today. Ask each distributor about their expiry-return terms (many give a credit note within a set window), record returns as purchase returns, and dispose of the rest as the rules for medicine waste require. Review how much of these items you buy.",
      impactInr: value,
      impactFormula: "Expired stock = units of expired batches × weighted-average cost",
      assumptions: [
        "Stock by batch comes from the batch numbers on purchase and sales lines; sales without a batch are taken from the earliest-expiring batch.",
        "Whether a distributor gives credit for expired stock depends on your agreement with them; this is not known from the books."
      ],
      measurePlan: { metric: "expired_stock_value", label: "Expired stock on hand", baseline: value, checkAfterDays: 30, successWhen: "falls by at least 90%", target: value * 0.1, direction: "decrease" }
    }
  ];
}

function nearExpiry(ctx: RuleContext): FindingDraft[] {
  if (!ctx.expiry) return [];
  const days = ctx.pack.thresholds.nearExpiryDays ?? 90;
  const atRisk = ctx.expiry.batches.filter((b) => b.daysToExpiry !== null && b.daysToExpiry >= 0 && b.daysToExpiry <= days && b.atRiskQty > 0 && b.atRiskValue !== null);
  const byItem = new Map<string, typeof atRisk>();
  for (const b of atRisk) byItem.set(b.itemId, [...(byItem.get(b.itemId) ?? []), b]);
  return [...byItem.entries()]
    .map(([itemId, batches]) => ({ itemId, batches, value: batches.reduce((s, b) => s + b.atRiskValue!, 0) }))
    .filter((x) => x.value >= C.nearExpiryMinValue)
    .sort((a, b) => b.value - a.value)
    .slice(0, C.nearExpiryMaxFindings)
    .map(({ itemId, batches, value }) => {
      const item = ctx.items.get(itemId)!;
      const first = batches[0];
      const rate = ctx.expiry!.dailyRate.get(itemId) ?? 0;
      const promotable = ctx.pack.campaignPolicy.isPromotable((item.attributes ?? {}) as Record<string, unknown>);
      const units = Math.round(batches.reduce((s, b) => s + b.atRiskQty, 0));
      return {
        ruleId: "NEAR_EXPIRY_AT_RISK",
        dedupeKey: `NEAR_EXPIRY_AT_RISK|${itemId}`,
        entityType: "item",
        entityId: itemId,
        entityLabel: item.name,
        severity: severityFor(value, 25_000, 5_000),
        title: `${inr(value)} of ${item.name} may expire before it sells (first batch expires ${first.expiryDate})`,
        whatHappened: `${units} units in ${batches.length} batch${batches.length === 1 ? "" : "es"} expiring within ${days} days are not expected to sell in time: the item sold ${(rate * 30).toFixed(1)} units a month over the last 90 days.`,
        evidence: {
          facts: [
            { label: "Units likely unsold at expiry", value: String(units) },
            { label: "Value at cost", value: inr(value) },
            { label: "Recent sales", value: `${(rate * 30).toFixed(1)} units a month` },
            { label: "Near-expiry window", value: `${days} days` }
          ],
          table: batchTable(ctx, batches, (b) => b.atRiskQty, (b) => b.atRiskValue)
        },
        whyItMatters: "Once these batches expire they cannot be sold, and their cost becomes a loss unless the distributor takes them back. Returns are usually easier before expiry than after.",
        suggestedAction: promotable.allowed
          ? `Ask the distributor to take back the batches you will not sell, or exchange them. Keep them at the front so they sell first, and stop reordering ${item.name} until they are gone. As it is not a prescription medicine, you may tell customers who bought it before that it is in stock${ctx.pack.campaignPolicy.generalOffersAllowed ? " or offer a discount" : " (campaigns in this trade carry no discounts)"}; the campaign still needs your approval.`
          : `Ask the distributor to take back or exchange the batches you will not sell before they expire. Keep them at the front so they sell first, and stop reordering ${item.name} until they are gone. Do not discount or promote it: ${promotable.reason ?? "this item may not be promoted"}.`,
        impactInr: value,
        impactFormula: "At risk = units not expected to sell before expiry (recent daily sales × days left, earliest batch first) × weighted-average cost",
        assumptions: [
          "Sales continue at the last 90 days' average; seasonal demand can make this better or worse.",
          "Earlier-expiring batches are sold first.",
          "The value is at cost; a return credit or exchange may recover some or all of it."
        ],
        measurePlan: {
          metric: "batch_stock_value",
          label: "Value still on hand from these batches",
          baseline: batches.reduce((s, b) => s + (b.value ?? 0), 0),
          checkAfterDays: C.nearExpiryCheckDays,
          successWhen: "falls by at least half",
          target: batches.reduce((s, b) => s + (b.value ?? 0), 0) / 2,
          direction: "decrease",
          subjects: batches.map((b) => b.batchId)
        }
      } satisfies FindingDraft;
    });
}
