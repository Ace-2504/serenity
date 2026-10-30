"use client";

import { useState, type ReactNode } from "react";

/** One shared hover/focus tooltip for a chart: values lead, labels follow. */
export function useTooltip() {
  const [tip, setTip] = useState<{ x: number; y: number; title: string; rows: { key?: string; label: string; value: string }[] } | null>(null);
  const bind = (title: string, rows: { key?: string; label: string; value: string }[]) => ({
    tabIndex: 0,
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const host = (e.currentTarget.closest("[data-viz-host]") as HTMLElement).getBoundingClientRect();
      setTip({ x: e.clientX - host.left, y: e.clientY - host.top, title, rows });
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const host = (e.currentTarget.closest("[data-viz-host]") as HTMLElement).getBoundingClientRect();
      const box = e.currentTarget.getBoundingClientRect();
      setTip({ x: box.left - host.left + box.width / 2, y: box.top - host.top, title, rows });
    },
    onPointerLeave: () => setTip(null),
    onBlur: () => setTip(null)
  });
  const node: ReactNode = tip && (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-[140px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-panel"
      style={{ left: tip.x, top: tip.y }}
    >
      <p className="mb-1 text-[11px] text-[var(--viz-text-2)]">{tip.title}</p>
      {tip.rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2">
          {row.key && <span className="inline-block h-0.5 w-3 rounded" style={{ background: row.key }} />}
          <span className="font-semibold text-[var(--viz-text)]">{row.value}</span>
          <span className="text-[var(--viz-text-2)]">{row.label}</span>
        </p>
      ))}
    </div>
  );
  return { bind, node };
}
