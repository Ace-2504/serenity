import type { Route } from "next";
import Link from "next/link";
import { ColumnSeries } from "@/components/bi/charts/column-series";
import { Dumbbell } from "@/components/bi/charts/dumbbell";
import { ProfitBridge, type BridgeStep } from "@/components/bi/charts/profit-bridge";
import { FilterBar } from "@/components/bi/filter-bar";
import { formatCount, formatInr, formatInrCompact, formatPct } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { channelLabel, lookups } from "@/server/analytics/context";
import { stockPositions } from "@/server/analytics/inventory";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan, pct, profitability, type ProfitRow } from "@/server/analytics/profitability";
import { getBiContext } from "@/server/bi/context";

const SORTS = {
  net: (r: Row) => r.netSales.toNumber(),
  margin: (r: Row) => r.marginPct ?? -Infinity,
  contribution: (r: Row) => r.contribution.toNumber(),
  contributionPct: (r: Row) => r.contributionPct ?? -Infinity,
  stock: (r: Row) => r.stockValue ?? -Infinity,
  idle: (r: Row) => r.daysSinceLastSale ?? Infinity
} as const;
type SortKey = keyof typeof SORTS;
type Row = ProfitRow & { name: string; code: string; group: string; marginPct: number | null; contributionPct: number | null; stockValue: number | null; daysSinceLastSale: number | null };

type Search = { period?: string; from?: string; to?: string; channel?: string; group?: string; q?: string; sort?: string; dir?: string };

export default async function ProfitabilityPage({ searchParams }: { searchParams: Search }) {
  const bi = (await getBiContext())?.context;
  if (!bi) return <EmptyState />;
  const span = await dataSpan(bi.db);
  if (!span) return <EmptyState />;
  const { period, preset, label } = resolvePeriod(searchParams, span);
  const look = await lookups(bi.db, bi.tenant.domainPack);
  const filters = { channel: searchParams.channel || undefined, groupId: searchParams.group || undefined };

  const [[total], byChannel, byItem, byMonth, positions] = await Promise.all([
    profitability(bi.db, bi.tenant.id, period, "total", filters),
    profitability(bi.db, bi.tenant.id, period, "channel", { groupId: filters.groupId }),
    profitability(bi.db, bi.tenant.id, period, "item", filters),
    profitability(bi.db, bi.tenant.id, period, "month", filters),
    stockPositions(bi.db, bi.tenant.id, period.to)
  ]);

  if (!total) {
    return (
      <>
        <FilterBar action="/admin/erp/profitability" preset={preset} from={period.from} to={period.to} channels={look.channels.map((c) => ({ value: c, label: channelLabel(c) }))} groups={look.groups.map((g) => ({ value: g.id, label: g.name }))} values={{ ...filters, group: filters.groupId, q: searchParams.q }} />
        <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">No sales in this period for the selected filters.</p>
      </>
    );
  }

  const coverageNote = total.costCoverage < 1 ? `${formatPct((1 - total.costCoverage) * 100)} of net sales has unknown cost and is excluded from profit` : undefined;
  const status = total.costCoverage < 1 ? "partial" : "ok";
  const bridge: BridgeStep[] = [
    { label: "Gross sales", value: total.grossSales.toNumber(), kind: "total" },
    { label: "Discounts", value: total.discounts.toNumber(), kind: "minus" },
    { label: "Returns", value: total.salesReturns.toNumber(), kind: "minus" },
    { label: "Net sales", value: total.netSales.toNumber(), kind: "total" },
    ...(total.netSales.gt(total.netSalesKnownCost)
      ? [{ label: "Sales with unknown cost", value: total.netSales.sub(total.netSalesKnownCost).toNumber(), kind: "excluded" as const, note: "excluded from profit" }]
      : []),
    { label: "Cost of goods sold", value: total.cogs.toNumber(), kind: "minus" },
    { label: "Gross profit", value: total.grossProfit.toNumber(), kind: "total" },
    { label: "Channel charges", value: total.channelCharges.toNumber(), kind: "minus" },
    { label: "Contribution", value: total.contribution.toNumber(), kind: "total" }
  ];

  const months = byMonth.sort((a, b) => a.key.localeCompare(b.key));
  const monthLabel = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

  const rows: Row[] = byItem.map((r) => {
    const item = look.items.get(r.key);
    const pos = positions.get(r.key);
    return {
      ...r,
      name: item?.name ?? r.key,
      code: item?.code ?? "",
      group: item?.group ?? "—",
      marginPct: pct(r.grossProfit, r.netSalesKnownCost),
      contributionPct: pct(r.contribution, r.netSalesKnownCost),
      stockValue: pos?.value?.toNumber() ?? null,
      daysSinceLastSale: pos?.daysSinceLastSale ?? null
    };
  });
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const sortKey: SortKey = (Object.keys(SORTS) as SortKey[]).includes(searchParams.sort as SortKey) ? (searchParams.sort as SortKey) : "net";
  const dir = searchParams.dir === "asc" ? 1 : -1;
  const shown = rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q))
    .sort((a, b) => (SORTS[sortKey](a) - SORTS[sortKey](b)) * dir);
  const sortHref = (key: SortKey) => {
    const params = new URLSearchParams(Object.entries({ ...searchParams, sort: key, dir: sortKey === key && dir === -1 ? "asc" : "desc" }).filter(([, v]) => v) as [string, string][]);
    return `/admin/erp/profitability?${params.toString()}` as Route;
  };
  const channels = byChannel.filter((c) => c.netSalesKnownCost.gt(0)).sort((a, b) => b.netSales.comparedTo(a.netSales));

  return (
    <div className="space-y-6">
      <FilterBar
        action="/admin/erp/profitability"
        preset={preset}
        from={period.from}
        to={period.to}
        channels={look.channels.map((c) => ({ value: c, label: channelLabel(c) }))}
        groups={look.groups.map((g) => ({ value: g.id, label: g.name }))}
        values={{ channel: filters.channel, group: filters.groupId, q: searchParams.q }}
      />
      <p className="-mt-3 text-sm text-graphite">
        {label}: {period.from} to {period.to}. Amounts exclude GST.
      </p>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Net sales" value={formatInrCompact(total.netSales.toNumber())} sub={`${formatCount(total.invoices)} invoices`} metricId="net_sales" />
        <StatTile label="Gross profit" value={formatInrCompact(total.grossProfit.toNumber())} sub={`${formatPct(pct(total.grossProfit, total.netSalesKnownCost))} margin`} status={status} note={coverageNote} metricId="gross_profit" />
        <StatTile label="Channel charges" value={formatInrCompact(total.channelCharges.toNumber())} sub="Marketplace & gateway fees" metricId="channel_charges" />
        <StatTile label="Contribution" value={formatInrCompact(total.contribution.toNumber())} sub={`${formatPct(pct(total.contribution, total.netSalesKnownCost))} of net sales`} status={status} note={coverageNote} metricId="channel_contribution" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">From sales to contribution</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">Where each rupee of gross sales goes before it becomes contribution.</p>
          <ProfitBridge steps={bridge} format="inr" />
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-graphite">Show as table</summary>
            <table className="mt-2 w-full text-left">
              <tbody>
                {bridge.map((s) => (
                  <tr key={s.label} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">{s.label}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {s.kind === "total" ? "" : "−"}
                      {formatInr(s.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>

        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Margin by channel</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">Gross margin, and what is left after the channel&apos;s fees (contribution).</p>
          <Dumbbell
            rows={channels.map((c) => ({ label: channelLabel(c.key), start: pct(c.grossProfit, c.netSalesKnownCost) ?? 0, end: pct(c.contribution, c.netSalesKnownCost) ?? 0 }))}
            startLabel="Gross margin"
            endLabel="Contribution margin"
            format="pct"
          />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <caption className="sr-only">Profitability by channel</caption>
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3 text-right">Net sales</th>
                  <th className="py-2 pr-3 text-right">Gross margin</th>
                  <th className="py-2 pr-3 text-right">Fees</th>
                  <th className="py-2 text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.key} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">{channelLabel(c.key)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(c.netSales.toNumber())}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(pct(c.grossProfit, c.netSalesKnownCost))}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(c.channelCharges.toNumber())}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatPct(pct(c.contribution, c.netSalesKnownCost))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-xl">Net sales by month</h2>
          <div className="mt-4">
            <ColumnSeries points={months.map((m) => ({ label: monthLabel(m.key), value: m.netSales.toNumber() }))} format="inr" valueLabel="net sales" />
          </div>
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-xl">Gross margin by month</h2>
          <div className="mt-4">
            <ColumnSeries points={months.map((m) => ({ label: monthLabel(m.key), value: pct(m.grossProfit, m.netSalesKnownCost) }))} format="pct0" valueLabel="gross margin" />
          </div>
        </section>
      </div>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl">Products</h2>
          <p className="text-sm text-graphite">
            {formatCount(shown.length)} products{q && ` matching "${searchParams.q}"`}. Select a column to sort.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <caption className="sr-only">Product profitability</caption>
            <thead className="text-xs uppercase tracking-wide text-graphite">
              <tr>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Group</th>
                <SortHeader label="Net sales" href={sortHref("net")} active={sortKey === "net"} dir={dir} />
                <SortHeader label="Gross margin" href={sortHref("margin")} active={sortKey === "margin"} dir={dir} />
                <SortHeader label="Contribution" href={sortHref("contribution")} active={sortKey === "contribution"} dir={dir} />
                <SortHeader label="Contrib. %" href={sortHref("contributionPct")} active={sortKey === "contributionPct"} dir={dir} />
                <SortHeader label="Stock value" href={sortHref("stock")} active={sortKey === "stock"} dir={dir} />
                <SortHeader label="Days idle" href={sortHref("idle")} active={sortKey === "idle"} dir={dir} />
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 100).map((r) => (
                <tr key={r.key} className="border-t border-mist-light">
                  <td className="py-1.5 pr-3">
                    <Link href={`/admin/erp/products/${r.key}` as Route} className="font-semibold underline-offset-2 hover:underline">
                      {r.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-graphite">{r.code}</span>
                    {r.costCoverage < 1 && (
                      <span className="ml-2 rounded-full border border-terracotta px-2 text-[11px] text-terracotta" title="Some sales of this product have unknown cost; profit covers the rest only.">
                        partial cost
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-graphite">{r.group}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(r.netSales.toNumber())}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(r.marginPct)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${r.contribution.lt(0) ? "font-semibold text-terracotta" : ""}`}>{formatInrCompact(r.contribution.toNumber())}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(r.contributionPct)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.stockValue === null ? "unknown" : formatInrCompact(r.stockValue)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.daysSinceLastSale ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length > 100 && <p className="mt-2 text-xs text-graphite">Showing the first 100; narrow with search or filters.</p>}
      </section>
    </div>
  );
}

function SortHeader({ label, href, active, dir }: { label: string; href: Route; active: boolean; dir: number }) {
  return (
    <th className="py-2 pr-3 text-right" aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <Link href={href} className={`underline-offset-2 hover:underline ${active ? "text-ink" : ""}`}>
        {label}
        {active ? (dir === 1 ? " ↑" : " ↓") : ""}
      </Link>
    </th>
  );
}

function EmptyState() {
  return (
    <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">
      No data yet. <Link href="/admin/erp/imports" className="underline">Import your accounts</Link> or load the demo business to see profitability.
    </p>
  );
}

export const dynamic = "force-dynamic";
