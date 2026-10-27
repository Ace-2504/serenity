import type { Route } from "next";
import Link from "next/link";
import { NewCampaignForm } from "@/components/bi/campaign-forms";
import { formatDate } from "@/components/bi/format";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";
import { AUDIENCES } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  draft: "Draft",
  audience_approved: "Audience approved",
  content_approved: "Message approved",
  ready: "Approved to send",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled"
};

export default async function CampaignsPage() {
  const bi = (await getBiContext())?.context;
  if (!bi) return null;
  const campaigns = await bi.db.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { recipients: { where: { eligibility: "eligible", group: "treatment" } } } } } });
  return (
    <div className="space-y-6">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Campaigns</h2>
        <p className="mt-1 max-w-3xl text-sm text-graphite">
          Messages to customers who have agreed to hear from you. You approve the audience, the message, any offer and the send itself; nothing goes out automatically. A
          share of the audience is held back so you can see whether the campaign made a difference.
        </p>
      </section>
      {CAN_IMPORT.includes(bi.role) && (
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">New campaign</h3>
          <div className="mt-3">
            <NewCampaignForm audiences={AUDIENCES} />
          </div>
        </section>
      )}
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">Your campaigns</h3>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-sm text-graphite">None yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-mist-light">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/bi/campaigns/${c.id}` as Route} className="font-semibold underline-offset-2 hover:underline">
                  {c.name}
                </Link>
                <span className="text-graphite">
                  {STATUS_TEXT[c.status] ?? c.status} · {c._count.recipients} to contact · created {formatDate(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
