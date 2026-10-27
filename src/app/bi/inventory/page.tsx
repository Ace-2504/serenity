import type { Route } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { BarList } from "@/components/bi/charts/bar-list";
import { FilterBar } from "@/components/bi/filter-bar";
import { formatCount, formatInrCompact } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { lookups } from "@/server/analytics/context";
import { AGE_BUCKETS, averageInventory, stockAgeing, stockoutDays, stockPositions, turnoverMetrics } from "@/server/analytics/inventory";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan, profitability } from "@/server/analytics/profitability";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const D = Prisma.Decimal;

export default async function InventoryPage({ searchParams }: { searchParams: { period?: string; from?: string; to?: string } }) {
  const bi = (await getBiContext())?.context;
  const span = bi ? await dataSpan(bi.db) : null;
  if (!bi || !span) {
    return (
      <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">
        No data yet. <Link href="/bi/imports" className="underline">Import your accounts</Link> first.
      </p>
    );
  }
  const { period, preset, label } = resolvePeriod(searchParams, span);
  const look = await lookups(bi.db, bi.tenant.domainPack);
  const { slowMovingDays, deadStockDays } = look.pack.thresholds;

  const [positions, [total], avg, stockouts] = await Promise.all([
    stockPositions(bi.db, bi.tenant.id, period.to),
    profitability(bi.db, bi.tenant.id, period, "total"),
    averageInventory(bi.db, bi.tenant.id, period.from, period.to),
    stockoutDays(bi.db, bi.tenant.id, period.from, period.to)
  ]);
  const ageing = await stockAgeing(bi.db, bi.tenant.id, period.to, positions);
  const cogs = total?.cogs ?? new D(0);
  const { turnover, dio } = turnoverMetrics(cogs, avg.value, period.from, period.to, avg.unknownItems);

  const onHand = [...positions.values()].filter((p) => p.qty.gt(0));
  const valueKnown = onHand.filter((p) => p.value !== null);
  const inventoryValue = valueKnown.reduce((s, p) => s.add(p.value!), new D(0));
  const unknownValueItems = onHand.length - valueKnown.length;
  const idle = (p: (typeof onHand)[number]) => p.daysSinceLastSale ?? Infinity;
  const slow = onHand.filter((p) => idle(p) >= slowMovingDays);
  const dead = onHand.filter((p) => idle(p) >= deadStockDays);
  const sumValue = (list: typeof onHand) => list.reduce((s, p) => s.add(p.value ?? 0), new D(0)).toNumber();

  const buckets = AGE_BUCKETS.map((b, i) => ({
    label: b.label,
    value: ageing.reduce((s, row) => s.add(row.buckets[i].value ?? 0), new D(0)).toNumber()
  }));
  const byGroup = new Map<string, number>();
  for (const p of valueKnown) {
    const group = look.items.get(p.itemId)?.group ?? "—";
    byGroup.set(group, (byGroup.get(group) ?? 0) + p.value!.toNumber());
  }
  const unknownNote = unknownValueItems > 0 ? `${unknownValueItems} item(s) on hand have unknown cost (missing opening value)` : undefined;
  const nameOf = (id: string) => look.items.get(id)?.name ?? id;

  return (
    <div className="space-y-6">
      <FilterBar action="/bi/inventory" preset={preset} from={period.from} to={period.to} />
      <p className="-mt-3 text-sm text-graphite">
        {label}: {period.from} to {period.to}. Stock is valued at weighted-average cost as on {period.to}.
      </p>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Inventory value" value={formatInrCompact(inventoryValue.toNumber())} sub={`${formatCount(onHand.length)} items in stock`} status={unknownNote ? "partial" : "ok"} note={unknownNote} metricId="inventory_value" />
        <StatTile label="Inventory turnover" value={turnover.value === null ? "—" : `${turnover.value.toFixed(1)}×`} sub={dio.value === null ? undefined : `${dio.value} days of stock`} status={turnover.status} note={turnover.note} metricId="inventory_turnover" />
        <StatTile label="Slow-moving stock" value={formatInrCompact(sumValue(slow))} sub={`${formatCount(slow.length)} items unsold ≥ ${slowMovingDays} days`} metricId="slow_moving_value" />
        <StatTile label="Non-moving stock" value={formatInrCompact(sumValue(dead))} sub={`${formatCount(dead.length)} items unsold ≥ ${deadStockDays} days`} metricId="dead_stock_value" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">How old is the stock?</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">Value on hand by how long ago it was received (first in, first out).</p>
          <BarList rows={buckets} format="inr" valueLabel="stock value" />
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Stock value by group</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">Where the money in stock sits.</p>
          <BarList rows={[...byGroup.entries()].sort((a, b) => b[1] - a[1]).map(([g, v]) => ({ label: g, value: v }))} format="inr" valueLabel="stock value" />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Slow and non-moving items</h2>
          <p className="mt-1 text-sm text-graphite">Cash tied up in stock that has not sold for {slowMovingDays}+ days, largest first.</p>
          <ItemTable
            rows={slow
              .sort((a, b) => (b.value?.toNumber() ?? 0) - (a.value?.toNumber() ?? 0))
              .slice(0, 25)
              .map((p) => ({ id: p.itemId, name: nameOf(p.itemId), cells: [formatCount(p.qty.toNumber()), p.value === null ? "unknown" : formatInrCompact(p.value.toNumber()), p.daysSinceLastSale === null ? "never sold" : `${p.daysSinceLastSale}`] }))}
            headers={["On hand", "Value", "Days since sale"]}
            empty="No slow-moving stock."
          />
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Frequent stockouts</h2>
          <p className="mt-1 text-sm text-graphite">Days in the period with no stock while the item was selling.</p>
          <ItemTable
            rows={[...stockouts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 25)
              .map(([id, days]) => ({ id, name: nameOf(id), cells: [`${days}`, formatCount(positions.get(id)?.qty.toNumber() ?? 0)] }))}
            headers={["Stockout days", "On hand now"]}
            empty="No stockouts in this period."
          />
        </section>
      </div>
    </div>
  );
}

function ItemTable({ rows, headers, empty }: { rows: { id: string; name: string; cells: string[] }[]; headers: string[]; empty: string }) {
  if (rows.length === 0) return <p className="mt-3 text-sm text-graphite">{empty}</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-graphite">
          <tr>
            <th className="py-2 pr-3">Product</th>
            {headers.map((h) => (
              <th key={h} className="py-2 pr-3 text-right">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-mist-light">
              <td className="py-1.5 pr-3">
                <Link href={`/bi/products/${r.id}` as Route} className="underline-offset-2 hover:underline">
                  {r.name}
                </Link>
              </td>
              {r.cells.map((c, i) => (
                <td key={i} className="py-1.5 pr-3 text-right tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
