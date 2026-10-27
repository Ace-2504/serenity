import { formatInrCompact } from "@/components/bi/format";
import { RULES } from "@/server/findings/rules";

/** Display helpers for findings, shared by the overview and detail pages. */

export const RULE_LABELS: Record<string, string> = Object.fromEntries(RULES.map((r) => [r.id, r.label]));

const UNITS: Record<string, (v: number) => string> = {
  item_stock_value: formatInrCompact,
  expired_stock_value: formatInrCompact,
  batch_stock_value: formatInrCompact,
  channel_item_contribution: (v) => `${formatInrCompact(v)} per unit`,
  group_gross_margin: (v) => `${v.toFixed(1)}%`,
  group_discount_rate: (v) => `${v.toFixed(1)}%`,
  top5_share: (v) => `${v.toFixed(1)}%`,
  channel_fill_rate: (v) => `${v.toFixed(1)}%`,
  dso: (v) => `${Math.round(v)} days`,
  payer_delay: (v) => `${Math.round(v)} days late`,
  item_stockout_days: (v) => `${Math.round(v)} days`,
  customer_orders: (v) => `${Math.round(v)} order${Math.round(v) === 1 ? "" : "s"}`
};

export const formatMetric = (metric: string, value: number | null | undefined) => (value === null || value === undefined ? "—" : (UNITS[metric] ?? String)(value));

export const SEVERITY_STYLES: Record<string, string> = {
  high: "border-terracotta bg-terracotta text-canvas",
  medium: "border-mustard bg-mustard/30 text-ink",
  low: "border-mist text-graphite"
};

export const STATUS_LABELS: Record<string, string> = {
  open: "Needs a decision",
  accepted: "Accepted — being measured",
  snoozed: "Snoozed",
  dismissed: "Dismissed",
  resolved: "No longer seen in the data"
};

export const VERDICT_LABELS: Record<string, string> = {
  achieved: "Target reached",
  not_achieved: "Target not reached",
  insufficient_data: "Not enough data to judge"
};

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
export const bySeverityThenImpact = <T extends { severity: string; impactInr: { toNumber(): number } | null }>(a: T, b: T) =>
  (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || (b.impactInr?.toNumber() ?? 0) - (a.impactInr?.toNumber() ?? 0);

export function entityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  if (entityType === "item" || entityType === "channel_item") return `/bi/products/${entityId}`;
  if (entityType === "party") return `/bi/customers/${entityId}`;
  return null;
}
