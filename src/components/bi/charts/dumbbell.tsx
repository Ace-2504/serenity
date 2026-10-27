"use client";

import { useTooltip } from "@/components/bi/charts/tooltip";
import { formatAs, type FormatKind } from "@/components/bi/format";

/** Per-row change between two measures of the same scale (e.g. gross margin -> contribution margin). */
export function Dumbbell({ rows, startLabel, endLabel, format }: { rows: { label: string; start: number; end: number }[]; startLabel: string; endLabel: string; format: FormatKind }) {
  const { bind, node } = useTooltip();
  const lo = Math.min(0, ...rows.flatMap((r) => [r.start, r.end]));
  const hi = Math.max(...rows.flatMap((r) => [r.start, r.end]), 1);
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;

  return (
    <div className="viz-root relative" data-viz-host>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-[var(--viz-text-2)]" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--viz-series-1-soft)" }} />
          {startLabel}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--viz-series-1)" }} />
          {endLabel}
        </li>
      </ul>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
            <span className="truncate text-sm text-[var(--viz-text)]">{r.label}</span>
            <div
              className="relative h-7 outline-none focus-visible:ring-2 focus-visible:ring-ink"
              {...bind(r.label, [
                { key: "var(--viz-series-1-soft)", label: startLabel, value: formatAs(format, r.start) },
                { key: "var(--viz-series-1)", label: endLabel, value: formatAs(format, r.end) }
              ])}
            >
              {lo < 0 && <div className="absolute inset-y-0 border-l border-[var(--viz-axis)]" style={{ left: `${x(0)}%` }} />}
              <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-[var(--viz-grid)]" style={{ left: `${Math.min(x(r.start), x(r.end))}%`, width: `${Math.abs(x(r.end) - x(r.start))}%` }} />
              <Dot left={x(r.start)} color="var(--viz-series-1-soft)" />
              <Dot left={x(r.end)} color="var(--viz-series-1)" />
              <span className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-xs tabular-nums text-[var(--viz-text)]" style={Math.max(x(r.start), x(r.end)) > 70 ? { right: `${100 - Math.min(x(r.start), x(r.end))}%`, paddingRight: 10 } : { left: `${Math.max(x(r.start), x(r.end))}%`, paddingLeft: 10 }}>
                {formatAs(format, r.end)}
              </span>
            </div>
          </div>
        ))}
      </div>
      {node}
    </div>
  );
}

function Dot({ left, color }: { left: number; color: string }) {
  return <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--viz-surface)]" style={{ left: `${left}%`, background: color }} />;
}
