import { getDomainPack } from "@/domain/packs";
import { Prisma, type Campaign } from "@prisma/client";
import { customerRfm } from "@/server/analytics/customers";
import { dataSpan } from "@/server/analytics/profitability";
import type { TenantDb } from "@/server/db/tenant";
import { inHoldout, unsubscribeToken } from "@/server/campaigns/tokens";
import { approve, cancel, edit, startSending, validateOffer, WorkflowError, type Approval, type CampaignState, type Offer } from "@/server/campaigns/workflow";
import { sendEmail, transportName } from "@/server/campaigns/transport";

/**
 * Campaigns: audience rules over the books and predictions, consent-based eligibility, a
 * deterministic holdout, owner approvals for every step, and sending through the outbox.
 * Only customers whose latest consent record for the channel is "granted" can be contacted;
 * consent is checked again at send time.
 */

export const AUDIENCES = {
  lapsing: "Valuable customers who have gone quiet (lapsing)",
  low_repeat_probability: "Customers unlikely to order in the next 60 days (predicted)",
  past_buyers_of_item: "Customers who bought a product before",
  segment: "A customer segment"
} as const;
export type Audience = { source: keyof typeof AUDIENCES; itemId?: string; segment?: string; maxScore?: number };

export async function audienceParties(db: TenantDb, tenantId: string, audience: Audience): Promise<string[]> {
  const span = await dataSpan(db);
  if (!span) return [];
  if (audience.source === "lapsing" || audience.source === "segment") {
    const segment = audience.source === "lapsing" ? "lapsing" : audience.segment;
    return (await customerRfm(db, tenantId, span.to)).filter((r) => r.segment === segment).map((r) => r.partyId);
  }
  if (audience.source === "low_repeat_probability") {
    const rows = await db.prediction.findMany({
      where: { entityType: "party", score: { lt: audience.maxScore ?? 0.35 }, modelVersion: { status: "active", model: "repeat_purchase" } },
      select: { entityId: true }
    });
    return rows.map((r) => r.entityId);
  }
  if (audience.source === "past_buyers_of_item" && audience.itemId) {
    const rows = await db.$queryRaw<{ partyId: string }[]>`
      SELECT DISTINCT v."partyId" FROM "VoucherLine" l JOIN "Voucher" v ON v."tenantId" = l."tenantId" AND v."id" = l."voucherId"
      WHERE l."tenantId" = ${tenantId} AND l."itemId" = ${audience.itemId} AND v."type" = 'sales_invoice' AND v."status" = 'active'`;
    return rows.map((r) => r.partyId);
  }
  return [];
}

/** Latest consent status per party for a channel ("granted" | "revoked"), from the append-only log. */
export async function latestConsent(db: TenantDb, partyIds: string[], channel: string): Promise<Map<string, string>> {
  if (partyIds.length === 0) return new Map();
  const rows = await db.contactConsent.findMany({ where: { partyId: { in: partyIds }, channel }, orderBy: { recordedAt: "asc" }, select: { partyId: true, status: true } });
  return new Map(rows.map((r) => [r.partyId, r.status]));
}

type Eligibility = "eligible" | "no_consent" | "opted_out" | "no_address" | "not_named";

async function eligibility(db: TenantDb, partyIds: string[], channel: string): Promise<Map<string, Eligibility>> {
  const [parties, consent] = await Promise.all([db.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, email: true, anonymousBuyers: true } }), latestConsent(db, partyIds, channel)]);
  return new Map(
    parties.map((p) => {
      const status = consent.get(p.id);
      const e: Eligibility = p.anonymousBuyers ? "not_named" : !p.email ? "no_address" : status === "revoked" ? "opted_out" : status === "granted" ? "eligible" : "no_consent";
      return [p.id, e];
    })
  );
}

export function stateOf(c: Campaign, eligibleTreatment: number): CampaignState {
  const a = (at: Date | null, by: string | null) => (at && by ? { at: at.toISOString(), by } : undefined);
  const approvals = Object.fromEntries(
    (
      [
        ["audience", a(c.audienceApprovedAt, c.audienceApprovedBy)],
        ["content", a(c.contentApprovedAt, c.contentApprovedBy)],
        ["offer", a(c.offerApprovedAt, c.offerApprovedBy)],
        ["send", a(c.sendApprovedAt, c.sendApprovedBy)]
      ] as const
    ).filter(([, v]) => v)
  );
  return { status: c.status as CampaignState["status"], approvals, hasOffer: c.offer !== null, eligibleTreatment, subject: c.subject, body: c.body };
}

function persisted(state: CampaignState) {
  const at = (s: Approval) => (state.approvals[s] ? new Date(state.approvals[s]!.at) : null);
  const by = (s: Approval) => state.approvals[s]?.by ?? null;
  return {
    status: state.status,
    audienceApprovedAt: at("audience"),
    audienceApprovedBy: by("audience"),
    contentApprovedAt: at("content"),
    contentApprovedBy: by("content"),
    offerApprovedAt: at("offer"),
    offerApprovedBy: by("offer"),
    sendApprovedAt: at("send"),
    sendApprovedBy: by("send")
  };
}

const eligibleTreatment = (db: TenantDb, campaignId: string) => db.campaignRecipient.count({ where: { campaignId, eligibility: "eligible", group: "treatment" } });

/** Recomputes the recipient list from the audience rule. */
export async function buildRecipients(db: TenantDb, tenantId: string, campaign: Campaign) {
  const partyIds = await audienceParties(db, tenantId, campaign.audience as Audience);
  const elig = await eligibility(db, partyIds, campaign.channel);
  await db.$transaction(async (tx) => {
    await tx.campaignRecipient.deleteMany({ where: { campaignId: campaign.id } });
    await tx.campaignRecipient.createMany({
      data: [...elig.entries()].map(([partyId, e]) => ({
        tenantId,
        campaignId: campaign.id,
        partyId,
        eligibility: e,
        group: e === "eligible" && inHoldout(campaign.id, partyId, campaign.holdoutPct) ? "holdout" : "treatment",
        status: e === "eligible" ? "pending" : "skipped"
      }))
    });
  });
  const counts = await db.campaignRecipient.groupBy({ by: ["eligibility", "group"], where: { campaignId: campaign.id }, _count: { _all: true } });
  return counts.map((c) => ({ eligibility: c.eligibility, group: c.group, count: c._count._all }));
}

export async function createCampaign(db: TenantDb, tenantId: string, userId: string, input: { name: string; goal: string; audience: Audience; holdoutPct?: number }) {
  const campaign = await db.campaign.create({
    data: { tenantId, name: input.name, goal: input.goal, audience: input.audience as Prisma.InputJsonValue, holdoutPct: input.holdoutPct ?? 10, createdBy: userId }
  });
  await buildRecipients(db, tenantId, campaign);
  return campaign;
}

async function save(db: TenantDb, tenantId: string, userId: string, campaign: Campaign, next: CampaignState, data: Prisma.CampaignUpdateInput, action: string) {
  return db.$transaction(async (tx) => {
    const updated = await tx.campaign.update({ where: { id: campaign.id }, data: { ...data, ...persisted(next) } });
    await tx.auditLog.create({ data: { tenantId, actorUserId: userId, action: `campaign.${action}`, entity: "Campaign", entityId: campaign.id, before: { status: campaign.status }, after: { status: next.status } } });
    return updated;
  });
}

export async function updateCampaign(
  db: TenantDb,
  tenantId: string,
  userId: string,
  campaignId: string,
  change: { audience?: Audience; subject?: string; body?: string; offer?: Offer }
) {
  let campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
  if (change.audience) {
    campaign = await db.campaign.update({ where: { id: campaign.id }, data: { audience: change.audience as Prisma.InputJsonValue } });
    await buildRecipients(db, tenantId, campaign);
    const next = edit(stateOf(campaign, await eligibleTreatment(db, campaign.id)), "audience", {});
    campaign = await save(db, tenantId, userId, campaign, next, {}, "audience_changed");
  }
  if (change.subject !== undefined || change.body !== undefined) {
    const next = edit(stateOf(campaign, await eligibleTreatment(db, campaign.id)), "content", { subject: change.subject ?? campaign.subject, body: change.body ?? campaign.body });
    campaign = await save(db, tenantId, userId, campaign, next, { subject: change.subject?.slice(0, 200) ?? campaign.subject, body: change.body?.slice(0, 5000) ?? campaign.body }, "content_changed");
  }
  if (change.offer !== undefined) {
    const problems = validateOffer(change.offer);
    if (problems.length) throw new WorkflowError(problems.join("; "));
    if (change.offer !== null) await assertOffersAllowed(db, tenantId);
    const next = edit(stateOf(campaign, await eligibleTreatment(db, campaign.id)), "offer", { hasOffer: change.offer !== null });
    campaign = await save(db, tenantId, userId, campaign, next, { offer: change.offer === null ? Prisma.JsonNull : (change.offer as Prisma.InputJsonValue) }, "offer_changed");
  }
  return campaign;
}

/** Owner approval of one step. The audience is recomputed first, so the owner approves the current list. */
/** The trade's campaign policy: no general offers where they would discount items that may not be promoted. */
async function assertOffersAllowed(db: TenantDb, tenantId: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { domainPack: true } });
  const pack = getDomainPack(tenant.domainPack);
  if (!pack.campaignPolicy.generalOffersAllowed) {
    throw new WorkflowError(`${pack.label} campaigns cannot carry an offer: a discount on the next order would also apply to prescription medicines, which may not be promoted. Send the message without an offer.`);
  }
}

export async function approveStep(db: TenantDb, tenantId: string, userId: string, campaignId: string, step: Approval) {
  let campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
  if (step === "offer" || (step === "send" && campaign.offer !== null)) await assertOffersAllowed(db, tenantId);
  if (step === "audience") await buildRecipients(db, tenantId, campaign);
  const next = approve(stateOf(campaign, await eligibleTreatment(db, campaign.id)), step, userId);
  campaign = await save(db, tenantId, userId, campaign, next, {}, `approve_${step}`);
  return campaign;
}

export async function cancelCampaign(db: TenantDb, tenantId: string, userId: string, campaignId: string) {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
  return save(db, tenantId, userId, campaign, cancel(stateOf(campaign, 0)), {}, "cancel");
}

/** Moves an approved campaign to "sending"; the job does the rest. */
export async function markSending(db: TenantDb, tenantId: string, userId: string, campaignId: string) {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
  return save(db, tenantId, userId, campaign, startSending(stateOf(campaign, await eligibleTreatment(db, campaign.id))), {}, "send");
}

function render(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

/**
 * Sends a campaign that the owner approved. Consent is checked again here: anyone who opted out
 * after approval is skipped. Holdout customers are never contacted.
 */
export async function sendCampaign(db: TenantDb, tenantId: string, campaignId: string, appUrl: string) {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId } });
  if (campaign.status !== "sending" || !campaign.sendApprovedAt) throw new WorkflowError("The campaign has not been approved for sending");
  const recipients = await db.campaignRecipient.findMany({ where: { campaignId, group: "treatment", eligibility: "eligible", status: "pending" }, include: { party: { select: { id: true, name: true, email: true } } } });
  const now = await eligibility(db, recipients.map((r) => r.partyId), campaign.channel);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const offer = campaign.offer as Offer;
  let sent = 0;
  let skipped = 0;
  for (const r of recipients) {
    if (now.get(r.partyId) !== "eligible" || !r.party.email) {
      // Eligibility stays as approved, so results compare everyone assigned to each group (intent to treat).
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "skipped" } });
      skipped += 1;
      continue;
    }
    const unsubscribe = `${appUrl.replace(/\/+$/, "")}/u/${unsubscribeToken(tenantId, r.partyId, campaign.channel)}`;
    const vars = { name: r.party.name, business: tenant.name, offer: offer ? `${offer.value}% off` : "" };
    const subject = render(campaign.subject ?? "", vars);
    const body = `${render(campaign.body ?? "", vars)}\n\n—\n${tenant.name}\nTo stop receiving these messages: ${unsubscribe}`;
    const result = await sendEmail({ to: r.party.email, subject, body, unsubscribeUrl: unsubscribe });
    await db.$transaction([
      db.outboxMessage.create({
        data: { tenantId, campaignId, recipientId: r.id, channel: campaign.channel, toAddress: r.party.email, subject, body, status: result.status, transport: result.transport, providerId: result.providerId, error: result.error, sentAt: result.status === "sent" ? new Date() : null }
      }),
      db.campaignRecipient.update({ where: { id: r.id }, data: { status: result.status === "failed" ? "failed" : "sent", sentAt: new Date() } })
    ]);
    if (result.status !== "failed") sent += 1;
  }
  await db.campaign.update({ where: { id: campaignId }, data: { status: "sent", sentAt: new Date() } });
  return { sent, skipped, transport: transportName() };
}

/**
 * Orders within N days after sending: the group assigned to be contacted vs the holdout, counting
 * everyone assigned at approval even if they opted out before sending (intent to treat), so the
 * comparison is not biased by who could be reached. Measured from invoices, with sample sizes.
 */
export async function campaignResults(db: TenantDb, tenantId: string, campaign: Campaign, days = 30) {
  if (!campaign.sentAt) return null;
  const from = campaign.sentAt;
  const to = new Date(from.getTime() + days * 86_400_000);
  const rows = await db.$queryRaw<{ group: string; recipients: bigint; buyers: bigint; net_sales: number | null }[]>`
    SELECT r."group", COUNT(DISTINCT r."partyId") AS recipients,
      COUNT(DISTINCT v."partyId") AS buyers, SUM(v."taxableAmount")::float AS net_sales
    FROM "CampaignRecipient" r
    LEFT JOIN "Voucher" v ON v."tenantId" = r."tenantId" AND v."partyId" = r."partyId" AND v."type" = 'sales_invoice' AND v."status" = 'active'
      AND v."date" > ${from}::date AND v."date" <= ${to}::date
    WHERE r."tenantId" = ${tenantId} AND r."campaignId" = ${campaign.id} AND r."eligibility" = 'eligible'
    GROUP BY 1`;
  return rows.map((r) => ({ group: r.group, recipients: Number(r.recipients), buyers: Number(r.buyers), rate: Number(r.recipients) ? Number(r.buyers) / Number(r.recipients) : null, netSales: r.net_sales ?? 0 }));
}
