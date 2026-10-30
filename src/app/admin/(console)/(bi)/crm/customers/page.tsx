import type { Route } from "next";
import Link from "next/link";
import { BarList } from "@/components/bi/charts/bar-list";
import { FilterBar } from "@/components/bi/filter-bar";
import { formatCount, formatDate, formatInrCompact, formatPct } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { CustomerDirectory } from "@/components/bi/customer-directory";
import { concentration, customerRfm, orderMetrics, SEGMENT_LABELS, type Segment } from "@/server/analytics/customers";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan } from "@/server/analytics/profitability";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const SEGMENT_ORDER: Segment[] = ["champion", "loyal", "new", "steady", "lapsing", "at_risk", "inactive"];

export default async function CustomersPage({ searchParams }: { searchParams: { period?: string; from?: string; to?: string; segment?: string; q?: string } }) {
  const bi = (await getBiContext())?.context;
  const span = bi ? await dataSpan(bi.db) : null;
  if (bi && !span) {
    // Shop accounts can be in the CRM before anyone has bought.
    return (
      <div className="space-y-6">
        <CustomerDirectory db={bi.db} q={searchParams.q ?? ""} lastPurchase={new Map()} />
      </div>
    );
  }
  if (!bi || !span) {
    return (
      <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">
        No data yet. <Link href="/admin/erp/imports" className="underline">Import your accounts</Link> first.
      </p>
    );
  }
  const { period, preset, label } = resolvePeriod(searchParams, span);
  const [metrics, rfm, conc, parties] = await Promise.all([
    orderMetrics(bi.db, bi.tenant.id, period),
    customerRfm(bi.db, bi.tenant.id, period.to),
    concentration(bi.db, bi.tenant.id, period),
    bi.db.party.findMany({ select: { id: true, name: true, segmentTag: true } })
  ]);
  const party = new Map(parties.map((p) => [p.id, p]));
  const bySegment = SEGMENT_ORDER.map((s) => {
    const list = rfm.filter((c) => c.segment === s);
    return { segment: s, count: list.length, value: list.reduce((sum, c) => sum + c.monetary, 0) };
  });
  const selected = SEGMENT_ORDER.includes(searchParams.segment as Segment) ? (searchParams.segment as Segment) : "lapsing";
  // Most valuable first: who is worth a call.
  const list = rfm.filter((c) => c.segment === selected).sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  return (
    <div className="space-y-6">
      <CustomerDirectory db={bi.db} q={searchParams.q ?? ""} lastPurchase={new Map(rfm.map((c) => [c.partyId, c.lastPurchase]))} />
      <FilterBar action="/admin/crm/customers" preset={preset} from={period.from} to={period.to} />
      <p className="-mt-3 text-sm text-graphite">
        {label}: {period.from} to {period.to}. Segments are as on {period.to}. Counter cash sales and marketplace orders are excluded from customer figures because their buyers are not identifiable.
      </p>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Customers who bought" value={formatCount(metrics.namedCustomers)} sub={`${metrics.ordersPerCustomer?.toFixed(1) ?? "—"} orders each`} />
        <StatTile label="Repeat purchase rate" value={formatPct(metrics.repeatPurchaseRate === null ? null : metrics.repeatPurchaseRate * 100)} sub="bought at least twice in the period" />
        <StatTile label="Average order" value={metrics.aov === null ? "—" : formatInrCompact(metrics.aov)} sub={`median ${metrics.medianOrderValue === null ? "—" : formatInrCompact(metrics.medianOrderValue)}`} />
        <StatTile label="Top 5 buyers' share" value={formatPct(conc.top5Share === null ? null : conc.top5Share * 100)} sub={`top 10: ${formatPct(conc.top10Share === null ? null : conc.top10Share * 100)} · HHI ${conc.hhi ?? "—"}`} />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Customer segments</h2>
          <p className="mt-1 text-sm text-graphite">Based on how recently, how often and how much each customer buys. Select a segment to list its customers.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Segment</th>
                  <th className="py-2 pr-3 text-right">Customers</th>
                  <th className="py-2 text-right">Bought in last 12 months</th>
                </tr>
              </thead>
              <tbody>
                {bySegment.map((s) => (
                  <tr key={s.segment} className={`border-t border-mist-light ${s.segment === selected ? "bg-paper" : ""}`}>
                    <td className="py-1.5 pr-3">
                      <Link href={`/admin/crm/customers?${new URLSearchParams({ period: preset, from: period.from, to: period.to, segment: s.segment })}` as Route} className="font-semibold underline-offset-2 hover:underline">
                        {SEGMENT_LABELS[s.segment].label}
                      </Link>
                      <span className="block text-xs text-graphite">{SEGMENT_LABELS[s.segment].meaning}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatCount(s.count)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatInrCompact(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Biggest buyers</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">Share of net sales in the period. A marketplace counts as one buyer.</p>
          <BarList rows={conc.top.map((t) => ({ label: party.get(t.partyId)?.name ?? "—", value: t.share * 100, sub: formatInrCompact(t.net) }))} format="pct" valueLabel="share of net sales" />
        </section>
      </div>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">{SEGMENT_LABELS[selected].label}</h2>
        <p className="mt-1 text-sm text-graphite">{SEGMENT_LABELS[selected].meaning}.</p>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">No customers in this segment.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Last purchase</th>
                  <th className="py-2 pr-3 text-right">Days silent</th>
                  <th className="py-2 pr-3 text-right">Usual gap</th>
                  <th className="py-2 pr-3 text-right">Orders (all time)</th>
                  <th className="py-2 pr-3 text-right">Last 12 months</th>
                  <th className="py-2 text-right">All time</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 100).map((c) => (
                  <tr key={c.partyId} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">
                      <Link href={`/admin/crm/customers/${c.partyId}` as Route} className="font-semibold underline-offset-2 hover:underline">
                        {party.get(c.partyId)?.name ?? "—"}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-graphite">{party.get(c.partyId)?.segmentTag ?? "—"}</td>
                    <td className="py-1.5 pr-3">{formatDate(c.lastPurchase)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.recencyDays}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.usualGapDays === null ? "—" : `${Math.round(c.usualGapDays)} d`}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{c.lifetimeOrders}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(c.monetary)}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatInrCompact(c.lifetimeValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
