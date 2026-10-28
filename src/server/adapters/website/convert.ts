import { Prisma } from "@prisma/client";
import { toCsv } from "@/server/demo/csv";
import type { Issue } from "@/server/ingest/issues";
import type { UploadedFile } from "@/server/ingest/parse";
import {
  CHANNEL_CHARGE_COLUMNS,
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS,
  type ChannelChargeRow,
  type ItemRow,
  type PartyRow,
  type SettlementRow,
  type VoucherRow
} from "@/server/ingest/template";

/**
 * Turns this website's own records (products, stock, orders, customers, suppliers' bills) into the
 * import template, so the shop's books are built from what actually happened on the site. The
 * figures are copied, not estimated, with one exception: opening stock, which the shop never
 * recorded, is worked back from today's stock and is flagged as such.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const WEBSITE_CHANNEL = "own_web";
/** Order states in which goods left the shop. Cancelled and unpaid orders are not sales. */
const SOLD = new Set(["confirmed", "packed", "shipped", "delivered", "returned"]);

export type WebsiteSnapshot = {
  /** "Now" for stock purposes: when stockOnHand was read. */
  readAt: Date;
  variants: {
    id: string;
    sku: string;
    title: string;
    attributes: unknown;
    category: string;
    hsnCode: string;
    gstPercent: number;
    costPricePaise: number | null;
    stockOnHand: number | null;
  }[];
  customers: { id: string; name: string; email: string; phone: string; city: string }[];
  orders: {
    orderNumber: string;
    userId: string;
    status: string;
    paymentStatus: string;
    placedAt: Date;
    updatedAt: Date;
    shippingTotalInr: number;
    discountTotalInr: number;
    grandTotalInr: number;
    /** When the money was received: the order time for online payments, collection for cash on delivery. */
    paidAt: Date;
    items: { variantId: string; quantity: number; unitPriceInr: number; taxPercent: number; taxAmountInr: number }[];
    /** Gateway fee and GST on it, in paise, when the payment provider reported them. */
    gatewayFees: { ref: string; date: Date; feePaise: number; taxPaise: number }[];
  }[];
  purchases: {
    id: string;
    supplier: { id: string; name: string; gstin: string | null; phone: string | null; email: string | null; city: string | null; creditDays: number };
    billNumber: string;
    billDate: Date;
    paidOn: Date | null;
    lines: { variantId: string; quantity: number; unitCostPaise: number; gstPercent: number }[];
  }[];
};

export type WebsiteConversion = {
  files: UploadedFile[];
  issues: Issue[];
  summary: { period: { from: string; to: string }; orders: number; returns: number; purchases: number; items: number; customers: number; suppliers: number; openingWorkedOut: number };
};

/** The calendar date in India of a timestamp. */
export const indiaDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
const rupees = (x: Decimal | number | string) => new D(x).toFixed(2);
const paise = (p: number) => new D(p).div(100);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const customerCode = (userId: string) => `web:${userId}`;
export const supplierCode = (supplierId: string) => `sup:${supplierId}`;

function variantName(title: string, attributes: unknown): string {
  const values =
    attributes && typeof attributes === "object" && !Array.isArray(attributes)
      ? Object.values(attributes as Record<string, unknown>).filter((v) => typeof v === "string" || typeof v === "number")
      : [];
  return values.length ? `${title} (${values.join(", ")})` : title;
}

export function convertWebsite(snapshot: WebsiteSnapshot, period: { from: string; to: string }): WebsiteConversion {
  const issues: Issue[] = [];
  const warn = (code: string, entity: string, message: string) => issues.push({ severity: "warning", code, entity, message });
  const inPeriod = (date: string) => date >= period.from && date <= period.to;
  const variants = new Map(snapshot.variants.map((v) => [v.id, v]));

  const vouchers: VoucherRow[] = [];
  const settlements: SettlementRow[] = [];
  const charges: ChannelChargeRow[] = [];
  const usedCustomers = new Set<string>();
  /** Units that left (sold - returned) or arrived (purchased) since the period began, per variant. */
  const outSince = new Map<string, number>();
  const inSince = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  let orders = 0;
  let returns = 0;

  const line = (head: Omit<VoucherRow, "line_no" | "item_code" | "qty" | "rate" | "discount_amount" | "taxable_amount" | "gst_rate" | "tax_amount">, n: number, sku: string, qty: number, rate: Decimal, gst: number, tax: Decimal): VoucherRow => ({
    ...head,
    line_no: String(n),
    item_code: sku,
    qty: String(qty),
    rate: rate.toFixed(4),
    discount_amount: "0.00",
    taxable_amount: rupees(rate.mul(qty)),
    gst_rate: new D(gst).toFixed(2),
    tax_amount: rupees(tax)
  });

  for (const order of snapshot.orders) {
    if (!SOLD.has(order.status)) continue;
    const date = indiaDate(order.placedAt);
    if (!inPeriod(date)) continue;
    const party = customerCode(order.userId);
    usedCustomers.add(order.userId);
    const adjustment = order.shippingTotalInr - order.discountTotalInr;
    const head = {
      voucher_type: "sales_invoice",
      voucher_no: order.orderNumber,
      date,
      party_code: party,
      channel: WEBSITE_CHANNEL,
      order_ref: order.orderNumber,
      due_date: date,
      original_voucher_no: "",
      adjustment_incl_tax: adjustment ? rupees(adjustment) : ""
    };
    order.items.forEach((item, i) => {
      const sku = variants.get(item.variantId)?.sku ?? item.variantId;
      vouchers.push(line(head, i + 1, sku, item.quantity, new D(item.unitPriceInr), item.taxPercent, new D(item.taxAmountInr)));
      bump(outSince, item.variantId, item.quantity);
    });
    orders += 1;

    if (order.status === "returned") {
      // The shop records only that the order came back, so the whole order is returned on the day it was marked.
      const marked = indiaDate(order.updatedAt);
      const returnDate = marked > period.to ? period.to : marked;
      const back = { ...head, voucher_type: "sales_return", voucher_no: `RET-${order.orderNumber}`, date: returnDate, due_date: returnDate, original_voucher_no: order.orderNumber, adjustment_incl_tax: adjustment ? rupees(adjustment) : "" };
      order.items.forEach((item, i) => {
        const sku = variants.get(item.variantId)?.sku ?? item.variantId;
        vouchers.push(line(back, i + 1, sku, item.quantity, new D(item.unitPriceInr), item.taxPercent, new D(item.taxAmountInr)));
        bump(outSince, item.variantId, -item.quantity);
      });
      returns += 1;
    }

    // Money received: the shop marks online payments "paid" when the gateway confirms them, and cash
    // on delivery when the owner records it collected; until then it stays owed.
    if (order.paymentStatus === "paid") {
      const paid = indiaDate(order.paidAt);
      const receiptDate = paid < date ? date : paid > period.to ? period.to : paid;
      settlements.push({ voucher_type: "receipt", voucher_no: `RCPT-${order.orderNumber}`, date: receiptDate, party_code: party, against_voucher_no: order.orderNumber, amount: rupees(order.grandTotalInr) });
    }
    for (const fee of order.gatewayFees) {
      charges.push({
        channel: WEBSITE_CHANNEL,
        settlement_ref: fee.ref,
        settlement_date: indiaDate(fee.date),
        order_voucher_no: order.orderNumber,
        charge_type: "payment_gateway_fee",
        amount: rupees(paise(fee.feePaise - fee.taxPaise)),
        gst_amount: rupees(paise(fee.taxPaise))
      });
    }
  }
  // Orders placed after the period still took stock out of today's count.
  for (const order of snapshot.orders) {
    if (!SOLD.has(order.status) || indiaDate(order.placedAt) <= period.to) continue;
    for (const item of order.items) bump(outSince, item.variantId, order.status === "returned" ? 0 : item.quantity);
  }

  const suppliers = new Map<string, WebsiteSnapshot["purchases"][number]["supplier"]>();
  for (const bill of snapshot.purchases) {
    const date = indiaDate(bill.billDate);
    for (const l of bill.lines) bump(inSince, l.variantId, date >= period.from ? l.quantity : 0);
    if (!inPeriod(date)) continue;
    suppliers.set(bill.supplier.id, bill.supplier);
    const voucherNo = `${bill.supplier.name.slice(0, 20)}/${bill.billNumber}`.slice(0, 64);
    const head = {
      voucher_type: "purchase_invoice",
      voucher_no: voucherNo,
      date,
      party_code: supplierCode(bill.supplier.id),
      channel: "",
      order_ref: "",
      due_date: addDays(date, bill.supplier.creditDays),
      original_voucher_no: "",
      adjustment_incl_tax: ""
    };
    let total = new D(0);
    bill.lines.forEach((l, i) => {
      const rate = paise(l.unitCostPaise);
      const taxable = rate.mul(l.quantity);
      const tax = taxable.mul(l.gstPercent).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
      total = total.add(taxable).add(tax);
      vouchers.push(line(head, i + 1, variants.get(l.variantId)?.sku ?? l.variantId, l.quantity, rate, l.gstPercent, tax));
    });
    if (bill.paidOn) {
      settlements.push({ voucher_type: "payment", voucher_no: `PAY-${bill.id}`.slice(0, 64), date: indiaDate(bill.paidOn), party_code: supplierCode(bill.supplier.id), against_voucher_no: voucherNo, amount: rupees(total) });
    }
  }

  // Opening stock: today's stock, plus what went out since the period began, minus what came in.
  let openingWorkedOut = 0;
  let negative = 0;
  const items: ItemRow[] = snapshot.variants.map((v) => {
    const now = v.stockOnHand ?? 0;
    let opening = now + (outSince.get(v.id) ?? 0) - (inSince.get(v.id) ?? 0);
    if (opening < 0) {
      negative += 1;
      opening = 0;
    }
    if (opening > 0) openingWorkedOut += 1;
    return {
      item_code: v.sku,
      name: variantName(v.title, v.attributes),
      group: v.category,
      uom: "pcs",
      hsn_code: v.hsnCode,
      gst_rate: new D(v.gstPercent).toFixed(2),
      opening_qty: String(opening),
      opening_value: opening > 0 && v.costPricePaise !== null ? rupees(paise(v.costPricePaise).mul(opening)) : "",
      attributes_json: "{}"
    };
  });
  if (openingWorkedOut > 0) {
    warn(
      "WEBSITE_OPENING_STOCK_WORKED_OUT",
      "item",
      `Opening stock on ${period.from} for ${openingWorkedOut} products is worked out from today's stock, adding back what sold since and taking off what was bought. Stock changed by hand on the Products & stock page in that time makes it wrong.`
    );
  }
  if (negative > 0) warn("WEBSITE_OPENING_STOCK_NEGATIVE", "item", `${negative} products would have had less than no stock on ${period.from}; their opening stock is set to 0. Stock was probably added by hand without a purchase bill.`);
  const noCost = snapshot.variants.filter((v) => v.costPricePaise === null).length;
  if (noCost > 0) warn("WEBSITE_NO_COST", "item", `${noCost} products have no cost price yet, so their profit cannot be worked out. Record a purchase bill or set the cost on Products & stock.`);

  const customers = new Map(snapshot.customers.map((c) => [c.id, c]));
  const parties: PartyRow[] = [];
  for (const c of snapshot.customers) {
    parties.push({ party_code: customerCode(c.id), name: c.name || c.email, party_type: "customer", segment: "online", city: c.city, state_code: "", gstin: "", credit_days: "0", phone: c.phone, email: c.email, buyer_identity: "named" });
  }
  for (const id of usedCustomers) {
    if (!customers.has(id)) parties.push({ party_code: customerCode(id), name: "Former website customer", party_type: "customer", segment: "online", city: "", state_code: "", gstin: "", credit_days: "0", phone: "", email: "", buyer_identity: "named" });
  }
  for (const s of suppliers.values()) {
    parties.push({ party_code: supplierCode(s.id), name: s.name, party_type: "supplier", segment: "", city: s.city ?? "", state_code: s.gstin?.slice(0, 2) ?? "", gstin: s.gstin ?? "", credit_days: String(s.creditDays), phone: s.phone ?? "", email: s.email ?? "", buyer_identity: "named" });
  }

  const sum = (type: string, f: (v: VoucherRow) => string) => vouchers.filter((v) => v.voucher_type === type).reduce((s, v) => s.add(f(v)), new D(0));
  const controls: [string, Decimal][] = [
    ["sales_taxable", sum("sales_invoice", (v) => v.taxable_amount)],
    ["sales_tax", sum("sales_invoice", (v) => v.tax_amount)],
    ["sales_return_taxable", sum("sales_return", (v) => v.taxable_amount)],
    ["purchase_taxable", sum("purchase_invoice", (v) => v.taxable_amount)],
    ["purchase_return_taxable", new D(0)],
    ["receipts", settlements.filter((s) => s.voucher_type === "receipt").reduce((s, r) => s.add(r.amount), new D(0))],
    ["payments", settlements.filter((s) => s.voucher_type === "payment").reduce((s, r) => s.add(r.amount), new D(0))],
    ["channel_charges", charges.reduce((s, c) => s.add(c.amount), new D(0))]
  ];

  const today = indiaDate(snapshot.readAt);
  const files: UploadedFile[] = [
    { name: TEMPLATE_FILES.items, content: Buffer.from(toCsv(ITEM_COLUMNS, items)) },
    { name: TEMPLATE_FILES.parties, content: Buffer.from(toCsv(PARTY_COLUMNS, parties)) },
    { name: TEMPLATE_FILES.vouchers, content: Buffer.from(toCsv(VOUCHER_COLUMNS, vouchers)) },
    { name: TEMPLATE_FILES.settlements, content: Buffer.from(toCsv(SETTLEMENT_COLUMNS, settlements)) },
    {
      name: TEMPLATE_FILES.stockSummary,
      content: Buffer.from(toCsv(STOCK_SUMMARY_COLUMNS, snapshot.variants.map((v) => ({ item_code: v.sku, as_of: today, qty: String(v.stockOnHand ?? 0), value: "", valuation_method: "" }))))
    },
    { name: TEMPLATE_FILES.controlTotals, content: Buffer.from(toCsv(CONTROL_TOTAL_COLUMNS, controls.map(([metric, value]) => ({ metric, period_from: period.from, period_to: period.to, value: rupees(value) })))) }
  ];
  if (charges.length) files.push({ name: TEMPLATE_FILES.channelCharges, content: Buffer.from(toCsv(CHANNEL_CHARGE_COLUMNS, charges)) });

  return {
    files,
    issues,
    summary: { period, orders, returns, purchases: snapshot.purchases.filter((b) => inPeriod(indiaDate(b.billDate))).length, items: items.length, customers: parties.filter((p) => p.party_type === "customer").length, suppliers: suppliers.size, openingWorkedOut }
  };
}
