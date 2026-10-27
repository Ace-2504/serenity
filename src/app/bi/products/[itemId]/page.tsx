import Link from "next/link";
import { notFound } from "next/navigation";
import { ColumnSeries } from "@/components/bi/charts/column-series";
import { formatCount, formatDate, formatInr, formatInrCompact, formatPct } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { channelLabel } from "@/server/analytics/context";
import { stockoutDays, stockPositions } from "@/server/analytics/inventory";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan, pct, profitability } from "@/server/analytics/profitability";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  sales_invoice: "Sale",
  sales_return: "Return",
  purchase_invoice: "Purchase",
  purchase_return: "Purchase return",
  opening_stock: "Opening stock"
};

export default async function ProductPage({ params, searchParams }: { params: { itemId: string }; searchParams: { period?: string; from?: string; to?: string } }) {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  const item = await bi.db.item.findUnique({ where: { id: params.itemId }, include: { itemGroup: { select: { name: true } } } });
  const span = await dataSpan(bi.db);
  if (!item || !span) notFound();
  const { period, label } = resolvePeriod(searchParams, span);
  const filter = { itemId: item.id };

  const [[total], byChannel, byMonth, positions, stockouts, lines] = await Promise.all([
    profitability(bi.db, bi.tenant.id, period, "total", filter),
    profitability(bi.db, bi.tenant.id, period, "channel", filter),
    profitability(bi.db, bi.tenant.id, span, "month", filter),
    stockPositions(bi.db, bi.tenant.id, period.to),
    stockoutDays(bi.db, bi.tenant.id, period.from, period.to),
    bi.db.voucherLine.findMany({
      where: { itemId: item.id, voucher: { status: "active" } },
      orderBy: [{ voucher: { date: "desc" } }, { voucher: { postingSeq: "desc" } }],
      take: 25,
      include: { voucher: { select: { type: true, number: true, date: true, channel: true, party: { select: { name: true } } } } }
    })
  ]);
  const position = positions.get(item.id);
  const months = byMonth.sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="space-y-6">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <p className="text-sm text-graphite">
          <Link href="/bi/profitability" className="underline">
            Profitability
          </Link>{" "}
          / {item.itemGroup?.name ?? "—"}
        </p>
        <h2 className="mt-1 font-display text-3xl">{item.name}</h2>
        <p className="mt-1 font-mono text-xs text-graphite">
          {item.sourceKey}
          {item.hsnCode && ` · HSN ${item.hsnCode}`}
          {item.gstRate && ` · GST ${item.gstRate.toFixed()}%`} · {label}: {period.from} to {period.to}
        </p>
      </section>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Net sales" value={total ? formatInrCompact(total.netSales.toNumber()) : "₹0"} sub={total ? `${formatCount(total.unitsSold.toNumber())} units` : undefined} metricId="net_sales" />
        <StatTile
          label="Gross margin"
          value={total ? formatPct(pct(total.grossProfit, total.netSalesKnownCost)) : "—"}
          status={!total ? "unavailable" : total.costCoverage < 1 ? "partial" : "ok"}
          note={!total ? "no sales in the period" : "some sales have unknown cost"}
          metricId="gross_margin_pct"
        />
        <StatTile label="Contribution" value={total ? formatInrCompact(total.contribution.toNumber()) : "—"} sub={total ? `${formatPct(pct(total.contribution, total.netSalesKnownCost))} of net sales` : undefined} metricId="channel_contribution" />
        <StatTile
          label="In stock"
          value={position ? formatCount(position.qty.toNumber()) : "0"}
          sub={`${position?.value ? formatInrCompact(position.value.toNumber()) : "value unknown"} · last sale ${position?.lastSaleDate ? formatDate(position.lastSaleDate) : "never"} · ${stockouts.get(item.id) ?? 0} stockout days`}
          metricId="inventory_value"
        />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">Net sales by month (all data)</h3>
          <div className="mt-4">
            <ColumnSeries
              points={months.map((m) => ({ label: new Date(`${m.key}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), value: m.netSales.toNumber() }))}
              format="inr"
              valueLabel="net sales"
            />
          </div>
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">By channel</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Channel</th>
                  <th className="py-2 pr-3 text-right">Net sales</th>
                  <th className="py-2 pr-3 text-right">Gross margin</th>
                  <th className="py-2 text-right">Contribution</th>
                </tr>
              </thead>
              <tbody>
                {byChannel.map((c) => (
                  <tr key={c.key} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">{channelLabel(c.key)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(c.netSales.toNumber())}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatPct(pct(c.grossProfit, c.netSalesKnownCost))}</td>
                    <td className={`py-1.5 text-right tabular-nums ${c.contribution.lt(0) ? "font-semibold text-terracotta" : ""}`}>{formatInrCompact(c.contribution.toNumber())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">Latest transactions</h3>
        <p className="mt-1 text-sm text-graphite">The source lines behind the figures above.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-graphite">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Voucher</th>
                <th className="py-2 pr-3">Party</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3 text-right">Taxable value</th>
                <th className="py-2 text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-mist-light">
                  <td className="py-1.5 pr-3">{formatDate(l.voucher.date)}</td>
                  <td className="py-1.5 pr-3">
                    {TYPE_LABELS[l.voucher.type] ?? l.voucher.type}
                    {l.voucher.channel && l.voucher.type.startsWith("sales") ? ` · ${channelLabel(l.voucher.channel)}` : ""}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-xs">{l.voucher.number}</td>
                  <td className="py-1.5 pr-3">{l.voucher.party?.name ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{l.qty.toFixed()}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatInr(l.taxableAmount.toFixed(2))}</td>
                  <td className="py-1.5 text-right tabular-nums">{l.costAmount ? formatInr(l.costAmount.toFixed(2)) : l.voucher.type.startsWith("sales") ? "unknown" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
