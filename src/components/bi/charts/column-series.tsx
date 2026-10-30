"use client";

import { useTooltip } from "@/components/bi/charts/tooltip";
import { formatAs, type FormatKind } from "@/components/bi/format";

/** Single-series columns over time (e.g. monthly net sales). No legend: the title names the series. */
export function ColumnSeries({ points, format, valueLabel, height = 160 }: { points: { label: string; value: number | null }[]; format: FormatKind; valueLabel: string; height?: number }) {
  const { bind, node } = useTooltip();
  const values = points.map((p) => p.value ?? 0);
  const max = niceMax(Math.max(...values, 0));
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const ticks = [max, max / 2, 0].filter((t) => t >= min);
  const peak = values.indexOf(Math.max(...values));
  const last = points.length - 1;

  return (
    <div className="viz-root relative" data-viz-host>
      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
        <div className="relative text-right text-[11px] tabular-nums text-[var(--viz-neutral)]" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${((max - t) / span) * 100}%` }}>
              {formatAs(format, t)}
            </span>
          ))}
        </div>
        <div className="relative" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? "border-[var(--viz-axis)]" : "border-[var(--viz-grid)]"}`} style={{ top: `${((max - t) / span) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {points.map((p, i) => {
              const v = p.value ?? 0;
              const h = (Math.abs(v) / span) * 100;
              const showLabel = (i === peak || i === last) && p.value !== null;
              return (
                <div key={p.label} className="relative flex h-full flex-1 items-end justify-center" {...bind(p.label, [{ label: valueLabel, value: p.value === null ? "not available" : formatAs(format, v) }])}>
                  {showLabel && (
                    <span className="absolute whitespace-nowrap text-[10px] tabular-nums text-[var(--viz-text)]" style={{ bottom: `calc(${h}% + 4px)` }}>
                      {formatAs(format, v)}
                    </span>
                  )}
                  <div className="w-full max-w-[24px] rounded-t-[4px]" style={{ height: `${h}%`, background: p.value === null ? "var(--viz-grid)" : "var(--viz-series-1)" }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-[4rem] mt-1 flex gap-[2px] text-[10px] text-[var(--viz-neutral)]">
        {points.map((p, i) => (
          <span key={p.label} className="flex-1 truncate text-center">
            {i % Math.ceil(points.length / 8) === 0 || i === last ? p.label : ""}
          </span>
        ))}
      </div>
      {node}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}
