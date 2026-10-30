import type { Period } from "@/server/analytics/profitability";

export type PeriodPreset = "last12" | "fy" | "prevfy" | "all" | "custom";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fyStart = (d: Date) => new Date(Date.UTC(d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1, 3, 1));
const clamp = (p: Period, span: Period): Period => ({ from: p.from < span.from ? span.from : p.from, to: p.to > span.to ? span.to : p.to });

/**
 * Turns query parameters into a reporting period inside the data's span. Indian financial
 * years run April-March. Defaults to the last 12 months of available data.
 */
export function resolvePeriod(params: { period?: string; from?: string; to?: string }, span: Period): { period: Period; preset: PeriodPreset; label: string } {
  const end = new Date(`${span.to}T00:00:00Z`);
  const preset = (["last12", "fy", "prevfy", "all", "custom"].includes(params.period ?? "") ? params.period : "last12") as PeriodPreset;
  if (preset === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? "") && params.from! <= params.to!) {
    return { period: clamp({ from: params.from!, to: params.to! }, span), preset, label: "Custom period" };
  }
  if (preset === "all") return { period: span, preset, label: "All data" };
  if (preset === "fy" || preset === "prevfy") {
    const start = fyStart(end);
    if (preset === "prevfy") start.setUTCFullYear(start.getUTCFullYear() - 1);
    const stop = new Date(Date.UTC(start.getUTCFullYear() + 1, 2, 31));
    const label = `FY ${start.getUTCFullYear()}-${String(start.getUTCFullYear() + 1).slice(2)}`;
    return { period: clamp({ from: iso(start), to: iso(stop) }, span), preset, label };
  }
  const from = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate() + 1));
  return { period: clamp({ from: iso(from), to: span.to }, span), preset: "last12", label: "Last 12 months" };
}

export function daysIn(period: Period): number {
  return Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
}
