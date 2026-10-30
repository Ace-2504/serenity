"use client";

import { useTooltip } from "@/components/bi/charts/tooltip";
import { formatAs, type FormatKind } from "@/components/bi/format";

/** Single-series horizontal bars (magnitude by category). No legend: the title names the series. */
export function BarList({ rows, format, valueLabel }: { rows: { label: string; value: number; sub?: string }[]; format: FormatKind; valueLabel: string }) {
  const { bind, node } = useTooltip();
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="viz-root relative space-y-1.5" data-viz-host>
      {rows.map((r) => {
        const width = (r.value / max) * 100;
        return (
          <div key={r.label} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <span className="truncate text-sm text-[var(--viz-text)]">{r.label}</span>
            <div className="relative h-6 border-l border-[var(--viz-axis)]" {...bind(r.label, [{ label: r.sub ?? valueLabel, value: formatAs(format, r.value) }])}>
              <div className="absolute top-1 h-4 rounded-r-[4px]" style={{ width: `max(${width}%, ${r.value > 0 ? 2 : 0}px)`, background: "var(--viz-series-1)" }} />
              <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-xs tabular-nums text-[var(--viz-text)]" style={width > 80 ? { right: `${100 - width}%`, paddingRight: 6, color: "#fff" } : { left: `${width}%` }}>
                {formatAs(format, r.value)}
              </span>
            </div>
          </div>
        );
      })}
      {node}
    </div>
  );
}
