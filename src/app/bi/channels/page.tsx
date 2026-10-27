import type { Route } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/bi/filter-bar";
import { formatInrCompact, formatPct } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { chargeTotals, fillRate, payoutLag, unlinkedCharges } from "@/server/analytics/channels";
import { channelLabel, lookups } from "@/server/analytics/context";
import { resolvePeriod } from "@/server/analytics/period";
import { dataSpan, pct, profitability } from "@/server/analytics/profitability";
import { getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const Th = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <th className={`py-2 pr-3 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
const Td = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <td className={`py-1.5 pr-3 ${right ? "text-right tabular-nums" : ""}`}>{children}</td>;

export default async function ChannelsPage({ searchParams }: { searchParams: { period?: string; from?: string; to?: string } }) {
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
  const [byChannel, lag, fill, fillItems, totals, unlinked, look] = await Promise.all([
    profitability(bi.db, bi.tenant.id, period, "channel"),
    payoutLag(bi.db, bi.tenant.id, period),
    fillRate(bi.db, bi.tenant.id, period, "channel"),
    fillRate(bi.db, bi.tenant.id, period, "channel_item"),
    chargeTotals(bi.db, bi.tenant.id, period),
    unlinkedCharges(bi.db, bi.tenant.id, period),
    lookups(bi.db, bi.tenant.domainPack)
  ]);
  const lagBy = new Map(lag.map((l) => [l.channel, l]));
  const fillBy = new Map(fill.map((f) => [f.key, f]));
  const totalsBy = new Map(totals.map((t) => [t.channel, t]));
  const rows = [...byChannel].sort((a, b) => b.netSales.comparedTo(a.netSales));
  const charges = rows.reduce((s, r) => s + r.channelCharges.toNumber(), 0);
  const withheld = totals.reduce((s, t) => s + t.taxWithheld, 0);
  const periodCosts = totals.reduce((s, t) => s + t.periodCosts, 0);
  const shortItems = fillItems.filter((r) => r.ordered > r.supplied).sort((a, b) => (b.shortValue ?? 0) - (a.shortValue ?? 0)).slice(0, 15);
  const allFill = fill.reduce((s, f) => ({ o: s.o + f.ordered, s: s.s + f.supplied }), { o: 0, s: 0 });

  return (
    <div className="space-y-6">
      <FilterBar action="/bi/channels" preset={preset} from={period.from} to={period.to} />
      <p className="-mt-3 text-sm text-graphite">
        {label}: {period.from} to {period.to}. Sales and contribution by invoice date; deductions and payouts by settlement date. Amounts exclude GST.
      </p>

      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Channel fees on orders" value={formatInrCompact(charges)} sub="deducted by marketplaces, in contribution" metricId="channel_charges" />
        <StatTile label="Fees not tied to an order" value={formatInrCompact(periodCosts)} sub="storage, ads, subscriptions" />
        <StatTile label="Tax withheld (TCS + TDS)" value={formatInrCompact(withheld)} sub="claimable credits, not a cost" />
        <StatTile
          label="Fill rate, purchase orders"
          value={allFill.o > 0 ? formatPct((allFill.s / allFill.o) * 100) : "—"}
          status={allFill.o > 0 ? "ok" : "unavailable"}
          note="Upload the platforms' PO and GRN files"
          metricId="fill_rate"
        />
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Channels side by side</h2>
        <p className="mt-1 text-sm text-graphite">What each channel leaves you after the cost of goods and the fees it deducts.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-graphite">
              <tr>
                <Th>Channel</Th>
                <Th right>Net sales</Th>
                <Th right>Gross margin</Th>
                <Th right>Fees</Th>
                <Th right>Contribution</Th>
                <Th right>Contribution %</Th>
                <Th right>Paid after (median)</Th>
                <Th right>Fill rate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const l = lagBy.get(r.key);
                const f = fillBy.get(r.key);
                return (
                  <tr key={r.key} className="border-t border-mist-light">
                    <Td>
                      <Link href={`/bi/profitability?channel=${r.key}&period=${preset}&from=${period.from}&to=${period.to}` as Route} className="underline-offset-2 hover:underline">
                        {channelLabel(r.key)}
                      </Link>
                    </Td>
                    <Td right>{formatInrCompact(r.netSales.toNumber())}</Td>
                    <Td right>{formatPct(pct(r.grossProfit, r.netSalesKnownCost))}</Td>
                    <Td right>{r.channelCharges.isZero() ? "—" : formatInrCompact(r.channelCharges.toNumber())}</Td>
                    <Td right>{formatInrCompact(r.contribution.toNumber())}</Td>
                    <Td right>{formatPct(pct(r.contribution, r.netSalesKnownCost))}</Td>
                    <Td right>{l ? `${Math.round(l.medianDays)} days` : "—"}</Td>
                    <Td right>{f?.fillRate == null ? "—" : formatPct(f.fillRate * 100)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalsBy.size > 0 && (
          <p className="mt-3 text-xs text-graphite">
            &quot;Paid after&quot; is days from the invoice to the settlement that paid it. Fees not tied to an order and tax withheld are shown above, not in contribution.
          </p>
        )}
        {unlinked.length > 0 && (
          <p className="mt-2 text-xs text-terracotta">
            {unlinked.map((u) => `${channelLabel(u.channel)}: ${Number(u.charges)} fee line(s) worth ${formatInrCompact(u.amount)}`).join("; ")} name orders not found in your books, so they
            are not in contribution yet. They are linked automatically when those invoices are imported.
          </p>
        )}
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Short supply against purchase orders</h2>
        <p className="mt-1 text-sm text-graphite">Products where you supplied less than a platform ordered, largest shortfall first (at PO prices).</p>
        {shortItems.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">{fill.length === 0 ? "No purchase orders imported for this period." : "Every PO line was supplied in full."}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <Th>Product</Th>
                  <Th>Channel</Th>
                  <Th right>Ordered</Th>
                  <Th right>Supplied</Th>
                  <Th right>Fill rate</Th>
                  <Th right>Short value</Th>
                </tr>
              </thead>
              <tbody>
                {shortItems.map((r) => {
                  const [channel, itemId] = r.key.split("|");
                  return (
                    <tr key={r.key} className="border-t border-mist-light">
                      <Td>
                        <Link href={`/bi/products/${itemId}` as Route} className="underline-offset-2 hover:underline">
                          {look.items.get(itemId)?.name ?? "—"}
                        </Link>
                      </Td>
                      <Td>{channelLabel(channel)}</Td>
                      <Td right>{Math.round(r.ordered)}</Td>
                      <Td right>{Math.round(r.supplied)}</Td>
                      <Td right>{r.fillRate === null ? "—" : formatPct(r.fillRate * 100)}</Td>
                      <Td right>{r.shortValue === null ? "—" : formatInrCompact(r.shortValue)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
