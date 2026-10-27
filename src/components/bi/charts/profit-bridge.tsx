"use client";

import { useTooltip } from "@/components/bi/charts/tooltip";
import { formatAs, type FormatKind } from "@/components/bi/format";

export type BridgeStep = { label: string; value: number; kind: "total" | "minus" | "excluded"; note?: string };

const COLOR = { total: "var(--viz-series-1)", minus: "var(--viz-series-2)", excluded: "var(--viz-neutral)" };

/** Horizontal waterfall: totals grow from zero, deductions float from the running total. */
export function ProfitBridge({ steps, format }: { steps: BridgeStep[]; format: FormatKind }) {
  const { bind, node } = useTooltip();
  const max = Math.max(...steps.filter((s) => s.kind === "total").map((s) => s.value), 1);
  let running = 0;
  const rows = steps.map((step) => {
    let start: number;
    let end: number;
    if (step.kind === "total") {
      start = 0;
      end = step.value;
      running = step.value;
    } else {
      end = running;
      start = running - step.value;
      running = start;
    }
    return { ...step, left: (Math.min(start, end) / max) * 100, width: (Math.abs(end - start) / max) * 100 };
  });
  const used = new Set(steps.map((s) => s.kind));

  return (
    <div className="viz-root relative" data-viz-host>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--viz-text-2)]" aria-label="Legend">
        {used.has("total") && <Legend color={COLOR.total} label="Running total" />}
        {used.has("minus") && <Legend color={COLOR.minus} label="Deduction" />}
        {used.has("excluded") && <Legend color={COLOR.excluded} label="Excluded: cost unknown" />}
      </ul>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <span className={`truncate text-sm ${row.kind === "total" ? "font-semibold text-[var(--viz-text)]" : "text-[var(--viz-text-2)]"}`}>{row.label}</span>
            <div className="relative h-6 border-l border-[var(--viz-axis)]">
              <div
                {...bind(row.label, [{ key: COLOR[row.kind], label: row.note ?? (row.kind === "total" ? "total" : "deducted"), value: `${row.kind === "total" ? "" : "−"}${formatAs(format, row.value)}` }])}
                className="absolute top-1 h-4 cursor-default rounded-[4px] outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ink"
                style={{ left: `${row.left}%`, width: `max(${row.width}%, 2px)`, background: COLOR[row.kind] }}
              />
              <span
                className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-xs tabular-nums text-[var(--viz-text)]"
                style={row.left + row.width > 72 ? { right: `${100 - row.left}%`, paddingRight: 6 } : { left: `${row.left + row.width}%` }}
              >
                {row.kind === "total" ? "" : "−"}
                {formatAs(format, row.value)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {node}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </li>
  );
}
