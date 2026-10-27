import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as upload } from "@/app/api/bi/imports/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fillRate, payoutLag } from "@/server/analytics/channels";
import { profitability } from "@/server/analytics/profitability";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";
import { toCsv } from "@/server/demo/csv";
import { forTenant } from "@/server/db/tenant";
import { commitImport, type ImportSummary } from "@/server/ingest/pipeline";
import { CONTROL_TOTAL_COLUMNS, ITEM_COLUMNS, PARTY_COLUMNS, TEMPLATE_FILES, VOUCHER_COLUMNS, type VoucherRow } from "@/server/ingest/template";

/** Books + marketplace and quick-commerce files through the upload API, staging and commit. */

let userId: string;
let token: string;
let tenantId: string;
const APRIL = { from: "2025-04-01", to: "2025-04-30" };

const sale = (no: string, date: string, party: string, channel: string, orderRef: string, item: string, qty: number, rate: number, gst: number): VoucherRow => {
  const taxable = qty * rate;
  return {
    voucher_type: "sales_invoice", voucher_no: no, date, party_code: party, channel, order_ref: orderRef, due_date: "", original_voucher_no: "", line_no: "1", item_code: item,
    qty: String(qty), rate: rate.toFixed(2), discount_amount: "0.00", taxable_amount: taxable.toFixed(2), gst_rate: gst.toFixed(2), tax_amount: ((taxable * gst) / 100).toFixed(2), adjustment_incl_tax: ""
  };
};
const BOOKS: VoucherRow[] = [
  sale("SI-1", "2025-04-08", "AMZ", "amazon", "408-0000001-0000001", "NB-1", 2, 224, 12),
  sale("SI-2", "2025-04-09", "AMZ", "amazon", "408-0000002-0000002", "PEN-1", 1, 224, 18),
  sale("SI-3", "2025-04-05", "BLINKIT", "blinkit", "BLK-PO-1", "NB-1", 80, 30, 12)
];

function booksForm(vouchers: VoucherRow[]): FormData {
  const totals = { taxable: vouchers.reduce((s, v) => s + Number(v.taxable_amount), 0), tax: vouchers.reduce((s, v) => s + Number(v.tax_amount), 0) };
  const files: Record<string, string> = {
    [TEMPLATE_FILES.items]: toCsv(ITEM_COLUMNS, [
      { item_code: "NB-1", name: "Ruled notebook", group: "Notebooks", uom: "pcs", hsn_code: "4820", gst_rate: "12.00", opening_qty: "200", opening_value: "5000.00", attributes_json: "{}" },
      { item_code: "PEN-1", name: "Gel pen", group: "Pens", uom: "pcs", hsn_code: "9608", gst_rate: "18.00", opening_qty: "100", opening_value: "500.00", attributes_json: "{}" }
    ]),
    [TEMPLATE_FILES.parties]: toCsv(PARTY_COLUMNS, [
      { party_code: "AMZ", name: "Amazon.in buyers", party_type: "customer", segment: "marketplace", city: "", state_code: "", gstin: "", credit_days: "", phone: "", email: "", buyer_identity: "anonymous" },
      { party_code: "MEESHO", name: "Meesho buyers", party_type: "customer", segment: "marketplace", city: "", state_code: "", gstin: "", credit_days: "", phone: "", email: "", buyer_identity: "anonymous" },
      { party_code: "BLINKIT", name: "Blinkit Commerce Pvt Ltd", party_type: "customer", segment: "quick_commerce", city: "", state_code: "", gstin: "", credit_days: "30", phone: "", email: "", buyer_identity: "named" }
    ]),
    [TEMPLATE_FILES.vouchers]: toCsv(VOUCHER_COLUMNS, vouchers),
    [TEMPLATE_FILES.controlTotals]: toCsv(
      CONTROL_TOTAL_COLUMNS,
      Object.entries({ sales_taxable: totals.taxable, sales_tax: totals.tax, sales_return_taxable: 0, purchase_taxable: 0, purchase_return_taxable: 0, receipts: 0, payments: 0, channel_charges: 0 }).map(([metric, v]) => ({
        metric, period_from: APRIL.from, period_to: APRIL.to, value: v.toFixed(2)
      }))
    )
  };
  const form = new FormData();
  for (const [name, text] of Object.entries(files)) form.append("files", new File([text], name));
  return form;
}
function fixtureForm(...names: string[]): FormData {
  const form = new FormData();
  for (const name of names) form.append("files", new File([readFileSync(path.join(__dirname, "fixtures", name))], name));
  return form;
}
async function stageAndCommit(form: FormData) {
  const response = await upload(new NextRequest(new URL("/api/bi/imports", "http://localhost"), { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}; ${ACTIVE_TENANT_COOKIE}=${tenantId}` }, body: form }));
  const staged = (await response.json()) as { batchId: string; status: string; summary: ImportSummary; message?: string };
  expect(staged.status, staged.message ?? JSON.stringify(staged.summary?.issues)).toBe("validated");
  const committed = await commitImport(forTenant(tenantId), tenantId, staged.batchId, { userId });
  return { staged, committed };
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, passwordHash: "x" } });
  userId = user.id;
  token = createSessionToken({ userId, email: user.email, roles: [] });
  tenantId = (await prisma.tenant.create({ data: { name: "Marketplace test", domainPack: "stationery", memberships: { create: { userId, role: "owner_admin" } } } })).id;
  await stageAndCommit(booksForm(BOOKS));
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("Amazon settlement after the books", () => {
  it("links every order-level charge to its invoice by marketplace order id", async () => {
    const { staged, committed } = await stageAndCommit(fixtureForm("amazon-settlement-v2.txt"));
    expect(staged.summary.issues.byCode).toHaveProperty("ORDERS_MATCHED");
    expect(committed.summary.chargeLinks).toEqual({ linked: 9, unlinked: 0, ambiguous: 0 });
    const source = await prisma.dataSource.findFirstOrThrow({ where: { tenantId, kind: "marketplace_file" } });
    expect(source.name).toBe("Amazon settlements");
  });

  it("computes contribution after fees per product (tax withheld is not a cost)", async () => {
    const rows = await profitability(forTenant(tenantId), tenantId, APRIL, "channel_item");
    const items = new Map((await prisma.item.findMany({ where: { tenantId } })).map((i) => [i.id, i.sourceKey]));
    const byKey = new Map(rows.map((r) => [`${r.key.split("|")[0]}|${items.get(r.key.split("|")[1])}`, r]));
    // NB-1: 448 - 2 x 25 cost = 398 gross profit; fees 20 + 10 + 45 + 4 = 79.
    expect(byKey.get("amazon|NB-1")).toMatchObject({ channelCharges: expect.anything() });
    expect([byKey.get("amazon|NB-1")!.channelCharges.toFixed(2), byKey.get("amazon|NB-1")!.contribution.toFixed(2)]).toEqual(["79.00", "319.00"]);
    // PEN-1: 224 - 5 = 219; fees 20 + 10 + 5 (unrecognised, kept) = 35.
    expect([byKey.get("amazon|PEN-1")!.channelCharges.toFixed(2), byKey.get("amazon|PEN-1")!.contribution.toFixed(2)]).toEqual(["35.00", "184.00"]);
  });

  it("measures payout lag from actual dates", async () => {
    const [amazon] = await payoutLag(forTenant(tenantId), tenantId, APRIL);
    expect(amazon).toMatchObject({ channel: "amazon", orders: 2, meanDays: 7.5, medianDays: 7.5 });
  });

  it("treats the same settlement file uploaded again as a no-op", async () => {
    const response = await upload(new NextRequest(new URL("/api/bi/imports", "http://localhost"), { method: "POST", headers: { cookie: `${SESSION_COOKIE}=${token}; ${ACTIVE_TENANT_COOKIE}=${tenantId}` }, body: fixtureForm("amazon-settlement-v2.txt") }));
    expect((await response.json()).status).toBe("duplicate");
  });
});

describe("Blinkit purchase orders", () => {
  it("imports PO and GRN files and computes fill rate", async () => {
    await stageAndCommit(fixtureForm("blinkit-po-april.xlsx", "blinkit-grn-april.csv", "sku_map.csv"));
    const [blinkit] = await fillRate(forTenant(tenantId), tenantId, APRIL, "channel");
    expect(blinkit).toMatchObject({ key: "blinkit", pos: 2, lines: 3, ordered: 210, supplied: 130, shortLines: 2 });
    expect(blinkit.fillRate).toBeCloseTo(130 / 210, 6);
    // Short value at PO prices: 20 x 30 + 60 x 30.
    expect(blinkit.shortValue).toBe(2400);
  });
});

describe("Meesho payments before the invoices", () => {
  it("keeps charges whose orders are not in the books yet, then links them when the invoices arrive", async () => {
    const { staged, committed } = await stageAndCommit(fixtureForm("meesho-payments.xlsx"));
    expect(staged.summary.issues.byCode).toHaveProperty("ORDERS_NOT_IN_BOOKS");
    // 3 order-level lines for SO-1001_1 and 5 for SO-1002_1 (TDS is period-level).
    expect(committed.summary.chargeLinks?.unlinked).toBe(8);

    const withMeesho = [...BOOKS, sale("SI-4", "2025-04-10", "MEESHO", "meesho", "SO-1001_1", "NB-1", 1, 200, 12), sale("SI-5", "2025-04-11", "MEESHO", "meesho", "SO-1002_1", "PEN-1", 1, 100, 18)];
    const books = await stageAndCommit(booksForm(withMeesho));
    expect(books.committed.summary.chargeLinks).toMatchObject({ linked: 8, unlinked: 0 });
    const [meesho] = (await profitability(forTenant(tenantId), tenantId, APRIL, "channel")).filter((r) => r.key === "meesho");
    // Fees net of the 20.00 compensation: 10 + 60 + 10 + 50 + 30 - 20 = 140; TCS is not a cost.
    expect(meesho.channelCharges.toFixed(2)).toBe("140.00");
  });
});
