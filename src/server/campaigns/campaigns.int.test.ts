import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as approveRoute } from "@/app/api/bi/campaigns/[campaignId]/approve/route";
import { POST as unsubscribeRoute } from "@/app/api/unsubscribe/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";
import { approveStep, buildRecipients, campaignResults, createCampaign, markSending, sendCampaign, updateCampaign } from "@/server/campaigns/service";
import { readUnsubscribeToken } from "@/server/campaigns/tokens";
import { WorkflowError } from "@/server/campaigns/workflow";
import { toCsv } from "@/server/demo/csv";
import { forTenant } from "@/server/db/tenant";
import { commitImport, stageImport } from "@/server/ingest/pipeline";
import { CONTROL_TOTAL_COLUMNS, ITEM_COLUMNS, PARTY_COLUMNS, TEMPLATE_FILES, VOUCHER_COLUMNS } from "@/server/ingest/template";

/** Six customers who bought the same notebook: C1-C4 agreed to email, C5 opted out, C6 never asked. */

let tenantId: string;
let db: ReturnType<typeof forTenant>;
let itemId: string;
const party = new Map<string, string>();
const OWNER = "owner-user";
const APP = "https://app.example.test";

beforeAll(async () => {
  delete process.env.SMTP_URL;
  tenantId = (await prisma.tenant.create({ data: { name: "Campaign test", domainPack: "stationery" } })).id;
  db = forTenant(tenantId);
  const codes = ["C1", "C2", "C3", "C4", "C5", "C6"];
  const files = {
    [TEMPLATE_FILES.items]: toCsv(ITEM_COLUMNS, [{ item_code: "NB-1", name: "Ruled notebook", group: "Notebooks", uom: "pcs", hsn_code: "4820", gst_rate: "12.00", opening_qty: "100", opening_value: "2500.00", attributes_json: "{}" }]),
    [TEMPLATE_FILES.parties]: toCsv(
      PARTY_COLUMNS,
      codes.map((c) => ({ party_code: c, name: `Customer ${c}`, party_type: "customer", segment: "retailer", city: "", state_code: "", gstin: "", credit_days: "", phone: "", email: `${c.toLowerCase()}@example.com`, buyer_identity: "named" }))
    ),
    [TEMPLATE_FILES.vouchers]: toCsv(
      VOUCHER_COLUMNS,
      codes.map((c, i) => ({
        voucher_type: "sales_invoice", voucher_no: `SI-${i + 1}`, date: `2025-04-0${i + 1}`, party_code: c, channel: "", order_ref: "", due_date: "", original_voucher_no: "",
        line_no: "1", item_code: "NB-1", qty: "1", rate: "40.00", discount_amount: "0.00", taxable_amount: "40.00", gst_rate: "12.00", tax_amount: "4.80", adjustment_incl_tax: ""
      }))
    ),
    [TEMPLATE_FILES.controlTotals]: toCsv(
      CONTROL_TOTAL_COLUMNS,
      Object.entries({ sales_taxable: "240.00", sales_tax: "28.80", sales_return_taxable: "0.00", purchase_taxable: "0.00", purchase_return_taxable: "0.00", receipts: "0.00", payments: "0.00", channel_charges: "0.00" }).map(([metric, value]) => ({ metric, period_from: "2025-04-01", period_to: "2025-04-30", value }))
    )
  };
  const source = await db.dataSource.create({ data: { tenantId, kind: "csv_template", name: "Template upload" } });
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files: Object.entries(files).map(([name, t]) => ({ name, content: Buffer.from(t) })) });
  await commitImport(db, tenantId, staged.batchId);
  itemId = (await db.item.findFirstOrThrow()).id;
  for (const p of await db.party.findMany()) party.set(p.sourceKey, p.id);
  const consent = (code: string, status: string, at: string) => db.contactConsent.create({ data: { tenantId, partyId: party.get(code)!, channel: "email", status, source: "test", recordedAt: new Date(at) } });
  for (const c of ["C1", "C2", "C3", "C4"]) await consent(c, "granted", "2025-01-01");
  await consent("C5", "granted", "2025-01-01");
  await consent("C5", "revoked", "2025-02-01"); // the latest record decides
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const audience = () => ({ source: "past_buyers_of_item" as const, itemId });

describe("campaign audience and consent", () => {
  it("contacts only customers whose latest record is consent, and holds some back", async () => {
    const c = await createCampaign(db, tenantId, OWNER, { name: "Notebook restock", goal: "Repeat orders", audience: audience(), holdoutPct: 25 });
    const recipients = await db.campaignRecipient.findMany({ where: { campaignId: c.id } });
    const by = (code: string) => recipients.find((r) => r.partyId === party.get(code))!;
    expect(by("C5").eligibility).toBe("opted_out");
    expect(by("C6").eligibility).toBe("no_consent");
    expect(["C1", "C2", "C3", "C4"].map((code) => by(code).eligibility)).toEqual(Array(4).fill("eligible"));
    // Re-building gives the same holdout.
    const groups = recipients.map((r) => `${r.partyId}:${r.group}`).sort();
    await buildRecipients(db, tenantId, c);
    expect((await db.campaignRecipient.findMany({ where: { campaignId: c.id } })).map((r) => `${r.partyId}:${r.group}`).sort()).toEqual(groups);
  });
});

describe("approvals and sending", () => {
  let campaignId: string;

  it("cannot send before the owner approved every step, in order", async () => {
    const c = await createCampaign(db, tenantId, OWNER, { name: "Offer", goal: "Clear stock", audience: audience(), holdoutPct: 0 });
    campaignId = c.id;
    await expect(markSending(db, tenantId, OWNER, c.id)).rejects.toBeInstanceOf(WorkflowError);
    await expect(approveStep(db, tenantId, OWNER, c.id, "content")).rejects.toThrow(/audience first/);
    await approveStep(db, tenantId, OWNER, c.id, "audience");
    await expect(approveStep(db, tenantId, OWNER, c.id, "content")).rejects.toThrow(/Write a subject/);
    await updateCampaign(db, tenantId, OWNER, c.id, { subject: "Hello {{name}}", body: "Dear {{name}}, notebooks are back: {{offer}}.", offer: { kind: "percent_off", value: 10 } });
    await expect(updateCampaign(db, tenantId, OWNER, c.id, { offer: { kind: "percent_off", value: 80 } })).rejects.toThrow(/cannot exceed 50%/);
    for (const step of ["content", "offer", "send"] as const) await approveStep(db, tenantId, OWNER, c.id, step);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ready");
  });

  it("withdraws approvals when the message changes after approval", async () => {
    await updateCampaign(db, tenantId, OWNER, campaignId, { body: "Dear {{name}}, notebooks are back with {{offer}}." });
    const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect([c.status, c.contentApprovedAt, c.offerApprovedAt, c.sendApprovedAt]).toEqual(["audience_approved", null, null, null]);
    for (const step of ["content", "offer", "send"] as const) await approveStep(db, tenantId, OWNER, campaignId, step);
  });

  it("re-checks consent at send time and keeps messages in the local outbox", async () => {
    // C4 opts out after the owner approved the audience.
    await db.contactConsent.create({ data: { tenantId, partyId: party.get("C4")!, channel: "email", status: "revoked", source: "phone call" } });
    await markSending(db, tenantId, OWNER, campaignId);
    const result = await sendCampaign(db, tenantId, campaignId, APP);
    expect(result).toEqual({ sent: 3, skipped: 1, transport: "outbox" });
    const messages = await db.outboxMessage.findMany({ where: { campaignId }, include: { recipient: true } });
    expect(messages.map((m) => m.toAddress).sort()).toEqual(["c1@example.com", "c2@example.com", "c3@example.com"]);
    for (const m of messages) {
      expect(m).toMatchObject({ status: "held", transport: "outbox" });
      expect(m.subject).toMatch(/^Hello Customer C\d$/);
      expect(m.body).toContain("10% off");
      const token = /\/u\/(\S+)/.exec(m.body)![1];
      expect(readUnsubscribeToken(token)).toEqual({ tenantId, partyId: m.recipient.partyId, channel: "email" });
    }
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaignId } })).status).toBe("sent");
    await expect(markSending(db, tenantId, OWNER, campaignId)).rejects.toBeInstanceOf(WorkflowError);
  });

  it("records an unsubscribe from the link, so the next campaign leaves the customer out", async () => {
    const message = await db.outboxMessage.findFirstOrThrow({ where: { campaignId, toAddress: "c1@example.com" } });
    const token = /\/u\/(\S+)/.exec(message.body)![1];
    const response = await unsubscribeRoute(new NextRequest(new URL(`/api/unsubscribe?token=${token}`, "http://localhost"), { method: "POST" }));
    expect(response.status).toBe(200);
    const next = await createCampaign(db, tenantId, OWNER, { name: "Later", goal: "x", audience: audience(), holdoutPct: 0 });
    const c1 = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId: next.id, partyId: party.get("C1") } });
    expect(c1.eligibility).toBe("opted_out");
    const forged = await unsubscribeRoute(new NextRequest(new URL(`/api/unsubscribe?token=${token.slice(0, -2)}xx`, "http://localhost"), { method: "POST" }));
    expect(forged.status).toBe(400);
  });

  it("measures orders after sending for contacted customers vs the holdout", async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { sentAt: new Date("2025-04-02") } });
    const results = await campaignResults(db, tenantId, (await db.campaign.findUniqueOrThrow({ where: { id: campaignId } }))!);
    // Treatment C1-C4 (C4 was eligible at approval); C3 and C4 have invoices on 3 and 4 April.
    expect(results).toEqual([{ group: "treatment", recipients: 4, buyers: 2, rate: 0.5, netSales: 80 }]);
  });
});

describe("only the owner approves", () => {
  it("refuses approval from an accountant", async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "x" } });
    await prisma.membership.create({ data: { tenantId, userId: user.id, role: "accountant" } });
    const c = await createCampaign(db, tenantId, OWNER, { name: "Role test", goal: "x", audience: audience() });
    const token = createSessionToken({ userId: user.id, email: user.email, roles: [] });
    const response = await approveRoute(
      new NextRequest(new URL(`/api/bi/campaigns/${c.id}/approve`, "http://localhost"), { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}; ${ACTIVE_TENANT_COOKIE}=${tenantId}` }, body: JSON.stringify({ step: "audience" }) }),
      { params: { campaignId: c.id } }
    );
    expect(response.status).toBe(403);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});
