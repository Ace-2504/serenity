import Link from "next/link";
import { notFound } from "next/navigation";
import { ColumnSeries } from "@/components/bi/charts/column-series";
import { formatCount, formatDate, formatInr, formatInrCompact } from "@/components/bi/format";
import { StatTile } from "@/components/bi/stat-tile";
import { channelLabel } from "@/server/analytics/context";
import { customerRfm, SEGMENT_LABELS } from "@/server/analytics/customers";
import { dataSpan } from "@/server/analytics/profitability";
import { openBills, sumPending } from "@/server/analytics/working-capital";
import { ConsentForm } from "@/components/bi/campaign-forms";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

export default async function CustomerPage({ params }: { params: { partyId: string } }) {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  const [party, span] = await Promise.all([bi.db.party.findUnique({ where: { id: params.partyId } }), dataSpan(bi.db)]);
  if (!party || !span) notFound();

  const consents = await bi.db.contactConsent.findMany({ where: { partyId: party.id }, orderBy: { recordedAt: "desc" }, take: 5 });
  const [rfm, bills, invoices, monthly] = await Promise.all([
    customerRfm(bi.db, bi.tenant.id, span.to),
    openBills(bi.db, bi.tenant.id, "receivable", span.to),
    bi.db.voucher.findMany({
      where: { partyId: party.id, type: "sales_invoice", status: "active" },
      orderBy: [{ date: "desc" }, { postingSeq: "desc" }],
      take: 20,
      select: { id: true, number: true, date: true, channel: true, totalInclTax: true, dueDate: true }
    }),
    bi.db.$queryRaw<{ month: string; net: string }[]>`
      SELECT to_char(v."date", 'YYYY-MM') AS month, SUM(CASE WHEN v."type" = 'sales_invoice' THEN l."taxableAmount" ELSE -l."taxableAmount" END)::text AS net
      FROM "Voucher" v JOIN "VoucherLine" l ON l."tenantId" = v."tenantId" AND l."voucherId" = v."id"
      WHERE v."tenantId" = ${bi.tenant.id} AND v."partyId" = ${party.id} AND v."status" = 'active' AND v."type" IN ('sales_invoice', 'sales_return')
      GROUP BY 1 ORDER BY 1`
  ]);
  const me = rfm.find((c) => c.partyId === party.id);
  const mine = bills.filter((b) => b.partyId === party.id);
  const overdue = mine.filter((b) => b.daysOverdue > 0);

  return (
    <div className="space-y-6">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <p className="text-sm text-graphite">
          <Link href="/bi/customers" className="underline">
            Customers
          </Link>{" "}
          / {party.segmentTag ?? party.kind}
        </p>
        <h2 className="mt-1 font-display text-3xl">{party.name}</h2>
        <p className="mt-1 text-sm text-graphite">
          {party.city ?? ""} {party.creditDays ? `· ${party.creditDays} days credit` : ""} {party.anonymousBuyers ? "· individual buyers not identifiable" : ""}
        </p>
      </section>
      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Segment" value={me ? SEGMENT_LABELS[me.segment].label : "—"} sub={me ? SEGMENT_LABELS[me.segment].meaning : "No purchases in the last two years"} />
        <StatTile label="Last purchase" value={me ? formatDate(me.lastPurchase) : "—"} sub={me ? `${me.recencyDays} days ago · usually every ${me.usualGapDays === null ? "—" : Math.round(me.usualGapDays)} days` : undefined} />
        <StatTile label="Bought in last 12 months" value={me ? formatInrCompact(me.monetary) : "—"} sub={me ? `${formatCount(me.frequency)} orders · ${formatCount(me.lifetimeOrders)} all time` : undefined} />
        <StatTile label="Owes you" value={formatInrCompact(sumPending(mine))} sub={`${formatInrCompact(sumPending(overdue))} overdue across ${overdue.length} bill(s)`} metricId="ar_total" />
      </section>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">Net purchases by month</h3>
        <div className="mt-4">
          <ColumnSeries
            points={monthly.map((m) => ({ label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), value: Number(m.net) }))}
            format="inr"
            valueLabel="net purchases"
          />
        </div>
      </section>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">Latest invoices</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-graphite">
              <tr>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Invoice</th>
                <th className="py-2 pr-3">Channel</th>
                <th className="py-2 pr-3 text-right">Amount (incl. GST)</th>
                <th className="py-2 text-right">Still owed</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((v) => {
                const open = mine.find((b) => b.billId === v.id);
                return (
                  <tr key={v.id} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">{formatDate(v.date)}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{v.number}</td>
                    <td className="py-1.5 pr-3">{channelLabel(v.channel ?? "direct")}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInr(v.totalInclTax.toFixed(2))}</td>
                    <td className={`py-1.5 text-right tabular-nums ${open && open.daysOverdue > 0 ? "font-semibold text-terracotta" : ""}`}>
                      {open ? `${formatInr(open.pending)}${open.daysOverdue > 0 ? ` · ${open.daysOverdue} d overdue` : ""}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {!party.anonymousBuyers && (
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Permission to contact</h2>
          <p className="mt-1 text-sm text-graphite">
            Campaigns only reach customers whose latest record says they agreed. {party.email ? `Email on file: ${party.email}.` : "No email address on file."}
          </p>
          {consents.length === 0 ? (
            <p className="mt-2 text-sm">No consent recorded: this customer will not be contacted.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {consents.map((c) => (
                <li key={c.id}>
                  {formatDate(c.recordedAt)}: {c.channel} {c.status === "granted" ? "agreed" : "opted out"} ({c.source})
                </li>
              ))}
            </ul>
          )}
          {CAN_IMPORT.includes(bi.role) && (
            <div className="mt-3">
              <ConsentForm partyId={party.id} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
