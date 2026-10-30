import { describe, expect, it } from "vitest";
import { convertWebsite, type WebsiteSnapshot } from "@/server/adapters/website/convert";

const csv = (files: { name: string; content: Buffer }[], name: string) => {
  const text = files.find((f) => f.name === name)?.content.toString() ?? "";
  const [head, ...rows] = text.trim().split("\r\n");
  const cols = head.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
};

const base = (): WebsiteSnapshot => ({
  readAt: new Date("2026-10-20T06:00:00Z"),
  variants: [{ id: "v1", sku: "NB-1", title: "Notebook", attributes: { colour: "Blue" }, category: "Notebooks", hsnCode: "4820", gstPercent: 12, costPricePaise: null, stockOnHand: 2 }],
  customers: [{ id: "u1", name: "Asha", email: "asha@example.com", phone: "98", city: "Pune" }],
  orders: [],
  purchases: []
});
const order = (no: string, paymentStatus: string, qty: number, fees: WebsiteSnapshot["orders"][number]["gatewayFees"] = []): WebsiteSnapshot["orders"][number] => ({
  orderNumber: no,
  userId: "u1",
  status: "confirmed",
  paymentStatus,
  placedAt: new Date("2026-10-05T06:00:00Z"),
  updatedAt: new Date("2026-10-05T06:00:00Z"),
  shippingTotalInr: 0,
  discountTotalInr: 0,
  grandTotalInr: qty * 112,
  paidAt: new Date("2026-10-05T06:00:00Z"),
  items: [{ variantId: "v1", quantity: qty, unitPriceInr: 100, taxPercent: 12, taxAmountInr: qty * 12 }],
  gatewayFees: fees
});

describe("website to books conversion", () => {
  it("settles paid orders, leaves cash on delivery owed, and keeps the gateway's fee", () => {
    const s = base();
    s.orders = [order("W1", "paid", 1, [{ ref: "pay_1", date: new Date("2026-10-05T06:00:00Z"), feePaise: 236, taxPaise: 36 }]), order("W2", "cod_pending", 1)];
    const { files } = convertWebsite(s, { from: "2026-10-01", to: "2026-10-20" });
    expect(csv(files, "settlements.csv").map((r) => [r.against_voucher_no, r.amount])).toEqual([["W1", "112.00"]]);
    expect(csv(files, "channel_charges.csv")).toEqual([expect.objectContaining({ order_voucher_no: "W1", charge_type: "payment_gateway_fee", amount: "2.00", gst_amount: "0.36" })]);
    expect(csv(files, "vouchers.csv").every((r) => r.channel === "own_web")).toBe(true);
  });

  it("works opening stock back from today's count and says so", () => {
    const s = base();
    s.orders = [order("W1", "paid", 3)];
    const { files, issues } = convertWebsite(s, { from: "2026-10-01", to: "2026-10-20" });
    // 2 in stock today + 3 sold since 1 October = 5 at the start; no cost, so no value.
    expect(csv(files, "items.csv")[0]).toMatchObject({ item_code: "NB-1", name: "Notebook (Blue)", opening_qty: "5", opening_value: "" });
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["WEBSITE_OPENING_STOCK_WORKED_OUT", "WEBSITE_NO_COST"]));
  });

  it("never invents negative opening stock when stock was added without a bill", () => {
    const s = base();
    s.purchases = [{ id: "b1", supplier: { id: "s1", name: "Mill", gstin: null, phone: null, email: null, city: null, creditDays: 15 }, billNumber: "M-1", billDate: new Date("2026-10-02"), paidOn: null, lines: [{ variantId: "v1", quantity: 10, unitCostPaise: 5000, gstPercent: 12 }] }];
    const { files, issues } = convertWebsite(s, { from: "2026-10-01", to: "2026-10-20" });
    expect(csv(files, "items.csv")[0].opening_qty).toBe("0");
    expect(issues.map((i) => i.code)).toContain("WEBSITE_OPENING_STOCK_NEGATIVE");
    const bill = csv(files, "vouchers.csv").find((r) => r.voucher_type === "purchase_invoice")!;
    expect(bill).toMatchObject({ due_date: "2026-10-17", taxable_amount: "500.00", tax_amount: "60.00" });
    expect(csv(files, "settlements.csv")).toEqual([]);
  });
});
