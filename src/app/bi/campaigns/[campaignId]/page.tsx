import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignActions, CampaignEditor } from "@/components/bi/campaign-forms";
import { formatDate, formatDateTime, formatInrCompact } from "@/components/bi/format";
import { dataSpan } from "@/server/analytics/profitability";
import { CAN_DECIDE, CAN_IMPORT, getBiContext } from "@/server/bi/context";
import { SEGMENT_LABELS, type Segment } from "@/server/analytics/customers";
import { AUDIENCES, campaignResults, stateOf, type Audience } from "@/server/campaigns/service";
import { transportName } from "@/server/campaigns/transport";
import { mentionsOffer, pendingApprovals, type Offer } from "@/server/campaigns/workflow";

export const dynamic = "force-dynamic";

const audienceLabel = (a: Audience) => (a.source === "segment" && a.segment ? `${AUDIENCES.segment}: ${SEGMENT_LABELS[a.segment as Segment]?.label ?? a.segment}` : AUDIENCES[a.source]);

const ELIGIBILITY: Record<string, string> = {
  eligible: "Agreed to email",
  no_consent: "No consent recorded: excluded",
  opted_out: "Opted out: excluded",
  no_address: "No email address: excluded",
  not_named: "Not a named customer: excluded"
};

export default async function CampaignPage({ params }: { params: { campaignId: string } }) {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  const c = await bi.db.campaign.findFirst({ where: { id: params.campaignId } });
  if (!c) notFound();
  const [groups, messages, results, sample, span] = await Promise.all([
    bi.db.campaignRecipient.groupBy({ by: ["eligibility", "group"], where: { campaignId: c.id }, _count: { _all: true } }),
    bi.db.outboxMessage.groupBy({ by: ["status", "transport"], where: { campaignId: c.id }, _count: { _all: true } }),
    campaignResults(bi.db, bi.tenant.id, c),
    bi.db.campaignRecipient.findMany({ where: { campaignId: c.id, eligibility: "eligible" }, take: 8, include: { party: { select: { id: true, name: true } } }, orderBy: { party: { name: "asc" } } }),
    dataSpan(bi.db)
  ]);
  // Results need imported invoices covering the 30 days after sending.
  const resultsDue = c.sentAt ? new Date(c.sentAt.getTime() + 30 * 86_400_000) : null;
  const resultsReady = resultsDue !== null && span !== null && span.to >= resultsDue.toISOString().slice(0, 10);
  const eligibleTreatment = groups.filter((g) => g.eligibility === "eligible" && g.group === "treatment").reduce((s, g) => s + g._count._all, 0);
  const holdout = groups.filter((g) => g.group === "holdout").reduce((s, g) => s + g._count._all, 0);
  const state = stateOf(c, eligibleTreatment);
  const pending = pendingApprovals(state);
  const offer = c.offer as Offer;
  const live = !["sending", "sent", "cancelled"].includes(c.status);
  const steps: { key: string; label: string; done: { at: string; by: string } | undefined; show: boolean }[] = [
    { key: "audience", label: "Audience", done: state.approvals.audience, show: true },
    { key: "content", label: "Message", done: state.approvals.content, show: true },
    { key: "offer", label: "Offer", done: state.approvals.offer, show: state.hasOffer },
    { key: "send", label: "Send", done: state.approvals.send, show: true }
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/bi/campaigns" className="text-sm underline">
        ← Campaigns
      </Link>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">{c.name}</h2>
        <p className="mt-1 text-sm text-graphite">{c.goal}</p>
        <ol className="mt-4 flex flex-wrap gap-2 text-xs">
          {steps
            .filter((s) => s.show)
            .map((s) => (
              <li key={s.key} className={`rounded-full border px-3 py-1 ${s.done ? "border-forest text-forest" : "border-mist text-graphite"}`}>
                {s.label}: {s.done ? `approved ${formatDateTime(s.done.at)}` : "waiting for the owner"}
              </li>
            ))}
          {c.status === "sent" && <li className="rounded-full border border-ink px-3 py-1">Sent {formatDateTime(c.sentAt)}</li>}
          {c.status === "cancelled" && <li className="rounded-full border border-terracotta px-3 py-1 text-terracotta">Cancelled</li>}
        </ol>
        <div className="mt-4">
          <CampaignActions id={c.id} next={live ? (pending[0] ?? (c.status === "ready" ? "ready" : null)) : null} canDecide={CAN_DECIDE.includes(bi.role)} cancellable={live} />
        </div>
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">1. Audience</h3>
        <p className="mt-1 text-sm text-graphite">{audienceLabel(c.audience as Audience)}. {c.holdoutPct}% of eligible customers are held back and not contacted, to measure the effect.</p>
        {groups.length === 0 && <p className="mt-2 text-sm">No customer matches this audience right now. Cancel this campaign and choose another audience.</p>}
        <ul className="mt-2 space-y-1 text-sm">
          {groups.map((g) => (
            <li key={`${g.eligibility}|${g.group}`}>
              {g._count._all} · {ELIGIBILITY[g.eligibility] ?? g.eligibility}
              {g.eligibility === "eligible" && (g.group === "holdout" ? " (held back)" : " (will be contacted)")}
            </li>
          ))}
        </ul>
        {sample.length > 0 && (
          <p className="mt-2 text-xs text-graphite">
            For example:{" "}
            {sample.map((r, i) => (
              <span key={r.id}>
                {i > 0 && ", "}
                <Link href={`/bi/customers/${r.party.id}` as Route} className="underline">
                  {r.party.name}
                </Link>
              </span>
            ))}
            . Record consent on a customer&apos;s page.
          </p>
        )}
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">2. Message and offer</h3>
        {c.subject && <p className="mt-2 text-sm font-semibold">{c.subject}</p>}
        {c.body && <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>}
        <p className="mt-2 text-sm">{offer ? `Offer: ${offer.value}% off. It is a promise in the message; nothing is discounted automatically.` : "No offer."}</p>
        {offer && !mentionsOffer(c) && (
          <p className="mt-1 text-sm text-terracotta">The message does not mention the offer. Add {"{{offer}}"} where it should appear, or remove the offer; the offer cannot be approved until then.</p>
        )}
        <div className="mt-4">
          <CampaignEditor id={c.id} subject={c.subject ?? ""} body={c.body ?? ""} offer={offer?.value ?? null} editable={live && CAN_IMPORT.includes(bi.role)} />
        </div>
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">3. Sending and results</h3>
        <p className="mt-1 text-sm text-graphite">
          {transportName() === "outbox"
            ? "No email server is connected, so messages are kept in the outbox on this machine and not sent anywhere."
            : "Messages are sent through the email server configured by the owner, each with an unsubscribe link."}
        </p>
        {messages.length > 0 && (
          <p className="mt-2 text-sm">
            {messages.map((m) => `${m._count._all} ${m.status === "held" ? "kept in the outbox" : m.status} (${m.transport})`).join(" · ")}
          </p>
        )}
        {c.sentAt && !resultsReady && (
          <p className="mt-2 text-sm text-graphite">
            Results appear once your imported invoices cover the 30 days after sending (up to {formatDate(resultsDue)}); your data currently ends {formatDate(span?.to ?? null)}.
          </p>
        )}
        {results && resultsReady && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Group</th>
                  <th className="py-2 pr-3 text-right">Customers</th>
                  <th className="py-2 pr-3 text-right">Ordered within 30 days</th>
                  <th className="py-2 pr-3 text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.group} className="border-t border-mist-light">
                    <td className="py-1.5 pr-3">{r.group === "holdout" ? "Held back (not contacted)" : "Chosen to contact"}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.recipients}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.rate === null ? "—" : `${(r.rate * 100).toFixed(0)}%`}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatInrCompact(r.netSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-graphite">
              Measured from your invoices after {formatDate(c.sentAt)}. &quot;Chosen to contact&quot; includes anyone who opted out before the send, so the groups stay comparable.
              With {holdout} customers held back, small differences can be chance.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
