import type { Route } from "next";
import Link from "next/link";

export type TileStatus = "ok" | "partial" | "unavailable";

/** Label, value, an optional secondary line, and an honest status when inputs are incomplete. */
export function StatTile({ label, value, sub, status = "ok", note, metricId }: { label: string; value: string; sub?: string; status?: TileStatus; note?: string; metricId?: string }) {
  return (
    <article className="rounded-xl2 border border-mist bg-canvas p-4">
      <p className="flex items-center justify-between gap-2 text-xs uppercase tracking-wide text-graphite">
        <span>{label}</span>
        {metricId && (
          <Link href={`/admin/erp/metrics#${metricId}` as Route} className="normal-case tracking-normal underline-offset-2 hover:underline" aria-label={`How ${label} is calculated`}>
            how?
          </Link>
        )}
      </p>
      <p className="mt-2 text-3xl font-semibold text-ink">{status === "unavailable" ? "—" : value}</p>
      {sub && <p className="mt-1 text-sm text-graphite">{sub}</p>}
      {status !== "ok" && (
        <p className="mt-2 text-xs text-terracotta">
          {status === "partial" ? "Partial: " : "Not available: "}
          {note}
        </p>
      )}
    </article>
  );
}
