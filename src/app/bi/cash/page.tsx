import type { Route } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { BarList } from "@/components/bi/charts/bar-list";
import { FilterBar } from "@/components/bi/filter-bar";
import { formatInrCompact } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { averageInventory, stockPositions, turnoverMetrics } from "@/server/analytics/inventory";
import { daysIn, resolvePeriod } from "@/server/analytics/period";
import { dataSpan, profitability } from "@/server/analytics/profitability";
import { lookups } from "@/server/analytics/context";
import { ageBills, averageOpen, cashConversionCycle, cashFromFasterCollection, cashFromSlowStock, creditVolume, daysMetric, openBills, sumPending } from "@/server/analytics/working-capital";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const num = (v: string | undefined, fallback: number) => (v !== undefined && /^\d{1,3}$/.test(v) ? Number(v) : fallback);

export default async function CashPage({ searchParams }: { searchParams: { period?: string; from?: string; to?: string; target_dso?: string; clear_pct?: string; recovery_pct?: string } }) {
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
  const days = daysIn(period);
  const look = await lookups(bi.db, bi.tenant.domainPack);
  const [receivables, payables, avgAr, avgAp, creditSales, creditPurchases, [total], avgInv, positions, parties] = await Promise.all([
    openBills(bi.db, bi.tenant.id, "receivable", period.to),
    openBills(bi.db, bi.tenant.id, "payable", period.to),
    averageOpen(bi.db, bi.tenant.id, "receivable", period),
    averageOpen(bi.db, bi.tenant.id, "payable", period),
    creditVolume(bi.db, bi.tenant.id, "receivable", period),
    creditVolume(bi.db, bi.tenant.id, "payable", period),
    profitability(bi.db, bi.tenant.id, period, "total"),
    averageInventory(bi.db, bi.tenant.id, period.from, period.to),
    stockPositions(bi.db, bi.tenant.id, period.to),
    bi.db.party.findMany({ select: { id: true, name: true } })
  ]);
  const name = new Map(parties.map((p) => [p.id, p.name]));
  const ar = sumPending(receivables);
  const ap = sumPending(payables);
  const overdue = receivables.filter((b) => b.daysOverdue > 0);
  const dso = daysMetric(avgAr.value, creditSales, days, "credit sales");
  const dpo = daysMetric(avgAp.value, creditPurchases, days, "credit purchases");
  const { dio } = turnoverMetrics(total?.cogs ?? new Prisma.Decimal(0), avgInv.value, period.from, period.to, avgInv.unknownItems);
  const ccc = cashConversionCycle(dio, dso, dpo);
  const onHand = [...positions.values()].filter((p) => p.qty.gt(0));
  const inventory = onHand.reduce((s, p) => s + (p.value?.toNumber() ?? 0), 0);
  const slowValue = onHand.filter((p) => (p.daysSinceLastSale ?? Infinity) >= look.pack.thresholds.slowMovingDays).reduce((s, p) => s + (p.value?.toNumber() ?? 0), 0);

  const targetDso = num(searchParams.target_dso, Math.max(0, (dso.value ?? 0) - 15));
  const clearPct = num(searchParams.clear_pct, 50);
  const recoveryPct = num(searchParams.recovery_pct, 60);
  const fromCollection = dso.value === null ? 0 : cashFromFasterCollection(ar, dso.value, targetDso);
  const fromStock = cashFromSlowStock(slowValue, clearPct, recoveryPct);

  const overdueByCustomer = new Map<string, number>();
  for (const b of overdue) overdueByCustomer.set(b.partyId, (overdueByCustomer.get(b.partyId) ?? 0) + b.pending);
  const topOverdue = [...overdueByCustomer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  return (
    <div className="space-y-6">
      <FilterBar action="/bi/cash" preset={preset} from={period.from} to={period.to} />
      <p className="-mt-3 text-sm text-graphite">
        {label}: {period.from} to {period.to}. Balances as on {period.to}; receivables and payables include GST, inventory is at cost.
      </p>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Customers owe you" value={formatInrCompact(ar)} sub={`${formatInrCompact(sumPending(overdue))} overdue`} metricId="ar_total" />
        <StatTile label="You owe suppliers" value={formatInrCompact(ap)} sub={`${formatInrCompact(sumPending(payables.filter((b) => b.daysOverdue > 0)))} overdue`} metricId="ap_total" />
        <StatTile label="Money in stock" value={formatInrCompact(inventory)} sub={`${formatInrCompact(slowValue)} slow-moving`} metricId="inventory_value" />
        <StatTile label="Trade working capital" value={formatInrCompact(inventory + ar - ap)} sub="stock + receivables − payables" metricId="wc_trade" />
      </section>

      <section aria-label="Cash cycle" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Days to collect (DSO)" value={dso.value === null ? "—" : `${dso.value} days`} status={dso.status} note={dso.note} metricId="dso" />
        <StatTile label="Days of stock (DIO)" value={dio.value === null ? "—" : `${dio.value} days`} status={dio.status} note={dio.note} metricId="dio" />
        <StatTile label="Days to pay (DPO)" value={dpo.value === null ? "—" : `${dpo.value} days`} status={dpo.status} note={dpo.note} metricId="dpo" />
        <StatTile label="Cash conversion cycle" value={ccc.value === null ? "—" : `${ccc.value} days`} sub="days your cash is tied up" status={ccc.status} note={ccc.note} metricId="ccc" />
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Receivables by age</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">What customers owe, by days past the due date.</p>
          <BarList rows={ageBills(receivables).map((a) => ({ label: a.label, value: a.amount, sub: `${a.bills} bill(s)` }))} format="inr" valueLabel="owed" />
        </section>
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Payables by age</h2>
          <p className="mb-4 mt-1 text-sm text-graphite">What you owe suppliers, by days past the due date.</p>
          <BarList rows={ageBills(payables).map((a) => ({ label: a.label, value: a.amount, sub: `${a.bills} bill(s)` }))} format="inr" valueLabel="owed" />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Who to call first</h2>
          <p className="mt-1 text-sm text-graphite">Customers with the most overdue money.</p>
          {topOverdue.length === 0 ? (
            <p className="mt-3 text-sm text-graphite">Nothing overdue.</p>
          ) : (
            <table className="mt-3 w-full text-left text-sm">
              <tbody>
                {topOverdue.map(([id, amount]) => (
                  <tr key={id} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">
                      <Link href={`/bi/customers/${id}` as Route} className="underline-offset-2 hover:underline">
                        {name.get(id) ?? "—"}
                      </Link>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatInrCompact(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">What could free up cash?</h2>
          <p className="mt-1 text-sm text-graphite">Estimates, not promises: they assume the same sales volume and mix. Change the assumptions and recalculate.</p>
          <form action="/bi/cash" method="get" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input type="hidden" name="period" value={preset} />
            <input type="hidden" name="from" value={period.from} />
            <input type="hidden" name="to" value={period.to} />
            <label className="flex flex-col text-xs text-graphite">
              Collect in (days)
              <input type="number" name="target_dso" min={0} max={365} defaultValue={targetDso} className="rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-graphite">
              Clear slow stock (%)
              <input type="number" name="clear_pct" min={0} max={100} defaultValue={clearPct} className="rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm" />
            </label>
            <label className="flex flex-col text-xs text-graphite">
              …recovering (% of cost)
              <input type="number" name="recovery_pct" min={0} max={100} defaultValue={recoveryPct} className="rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm" />
            </label>
            <button type="submit" className="w-fit rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper sm:col-span-3">
              Recalculate
            </button>
          </form>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3 border-t border-mist-light pt-2">
              <dt>
                Collecting in {targetDso} days instead of {dso.value ?? "—"}
              </dt>
              <dd className="font-semibold tabular-nums">≈ {formatInrCompact(fromCollection)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-mist-light pt-2">
              <dt>
                Clearing {clearPct}% of slow stock at {recoveryPct}% of cost
              </dt>
              <dd className="font-semibold tabular-nums">≈ {formatInrCompact(fromStock)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
