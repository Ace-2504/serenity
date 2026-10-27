import { Prisma } from "@prisma/client";
import type { IssueLog } from "@/server/ingest/issues";
import type { ParsedBundle, VoucherDraft } from "@/server/ingest/parse";
import { CONTROL_TOTAL_METRICS } from "@/server/ingest/template";

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

/** Records already in the database for this data source, so a bundle may reference earlier imports. */
export type KnownRecords = {
  itemCodes: Set<string>;
  parties: Map<string, "customer" | "supplier" | "both">;
  /** "type|number" of vouchers already imported. */
  voucherKeys: Set<string>;
};

export const emptyKnown = (): KnownRecords => ({ itemCodes: new Set(), parties: new Map(), voucherKeys: new Set() });

/** Rounding tolerance for amounts stated by the source: one paisa. */
const PAISA = new D("0.01");
/** Tax may be rounded at invoice level by some packages; beyond one rupee per line it is an error. */
const RUPEE = new D("1");

export type ControlReconciliation = {
  metric: string;
  periodFrom: string;
  periodTo: string;
  stated: string;
  computed: string;
  difference: string;
  ok: boolean;
}[];

/** Totals of the bundle's own rows, using the same definitions as the control totals. */
export function computeTotals(bundle: Pick<ParsedBundle, "vouchers" | "settlements" | "charges">): Record<(typeof CONTROL_TOTAL_METRICS)[number], Decimal> {
  const sumLines = (type: string, field: "taxableAmount" | "taxAmount") =>
    bundle.vouchers.filter((v) => v.type === type).reduce((s, v) => v.lines.reduce((t, l) => t.add(l[field]), s), new D(0));
  const sumSettlements = (type: string) =>
    bundle.settlements.filter((s) => s.type === type).reduce((s, v) => v.allocations.reduce((t, a) => t.add(a.amount), s), new D(0));
  return {
    sales_taxable: sumLines("sales_invoice", "taxableAmount"),
    sales_tax: sumLines("sales_invoice", "taxAmount"),
    sales_return_taxable: sumLines("sales_return", "taxableAmount"),
    purchase_taxable: sumLines("purchase_invoice", "taxableAmount"),
    purchase_return_taxable: sumLines("purchase_return", "taxableAmount"),
    receipts: sumSettlements("receipt"),
    payments: sumSettlements("payment"),
    channel_charges: bundle.charges.reduce((s, c) => s.add(c.amount), new D(0))
  };
}

/**
 * Cross-row checks that need the whole bundle (and what is already imported).
 * Returns the reconciliation of the bundle against its stated control totals.
 */
export function validateBundle(bundle: ParsedBundle, known: KnownRecords, log: IssueLog): ControlReconciliation {
  // Masters: unique codes.
  const itemCodes = new Set<string>();
  for (const item of bundle.items) {
    if (itemCodes.has(item.code)) log.error("DUPLICATE_KEY", "item", `item_code ${item.code} appears more than once`, { rowRef: item.rowRef });
    itemCodes.add(item.code);
    if (item.openingValue !== null && item.openingQty.lte(0) && !item.openingValue.isZero()) {
      log.error("INVALID_VALUE", "item", `${item.code}: opening value without opening quantity`, { rowRef: item.rowRef, field: "opening_value" });
    }
    if (item.openingQty.gt(0) && item.openingValue === null) {
      log.warning(
        "MISSING_OPENING_VALUE",
        "item",
        `${item.code}: opening stock has no value, so its cost of goods sold will be reported as unknown until the stock is used up`,
        { rowRef: item.rowRef, field: "opening_value" }
      );
    }
  }
  const partyKinds = new Map(known.parties);
  const seenParties = new Set<string>();
  for (const party of bundle.parties) {
    if (seenParties.has(party.code)) log.error("DUPLICATE_KEY", "party", `party_code ${party.code} appears more than once`, { rowRef: party.rowRef });
    seenParties.add(party.code);
    partyKinds.set(party.code, party.kind);
  }
  const allItems = new Set([...known.itemCodes, ...itemCodes]);

  // Vouchers: references, roles, arithmetic.
  const voucherKeys = new Set([...known.voucherKeys, ...bundle.vouchers.map((v) => v.key)]);
  const salesByKey = new Map(bundle.vouchers.map((v) => [v.key, v]));
  const returnedQty = new Map<string, Decimal>();
  for (const voucher of bundle.vouchers) {
    const firstRow = voucher.lines[0]?.rowRef;
    const kind = partyKinds.get(voucher.partyCode);
    const wantsCustomer = voucher.type.startsWith("sales");
    if (!kind) {
      log.error("UNKNOWN_PARTY", "voucher", `${voucher.number}: party ${voucher.partyCode} is not in parties.csv or an earlier import`, { rowRef: firstRow, field: "party_code" });
    } else if (kind !== "both" && kind !== (wantsCustomer ? "customer" : "supplier")) {
      log.error("PARTY_ROLE_MISMATCH", "voucher", `${voucher.number}: ${voucher.type} with ${kind} ${voucher.partyCode}`, { rowRef: firstRow, field: "party_code" });
    }
    if (voucher.dueDate !== null && voucher.dueDate < voucher.date) {
      log.error("INVALID_VALUE", "voucher", `${voucher.number}: due date is before the voucher date`, { rowRef: firstRow, field: "due_date" });
    }
    for (const line of voucher.lines) {
      if (!allItems.has(line.itemCode)) {
        log.error("UNKNOWN_ITEM", "voucher", `${voucher.number}: item ${line.itemCode} is not in items.csv or an earlier import`, { rowRef: line.rowRef, field: "item_code" });
      }
      const expectedTaxable = line.grossAmount.sub(line.discountAmount);
      if (line.taxableAmount.sub(expectedTaxable).abs().gt(PAISA)) {
        log.error(
          "LINE_ARITHMETIC",
          "voucher",
          `${voucher.number} line ${line.lineNo}: taxable ${line.taxableAmount.toFixed(2)} != qty x rate - discount (${expectedTaxable.toFixed(2)})`,
          { rowRef: line.rowRef, field: "taxable_amount" }
        );
      }
      const expectedTax = line.taxableAmount.mul(line.taxRate).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP);
      const taxGap = line.taxAmount.sub(expectedTax).abs();
      if (taxGap.gt(RUPEE)) {
        log.error("TAX_ARITHMETIC", "voucher", `${voucher.number} line ${line.lineNo}: tax ${line.taxAmount.toFixed(2)} != ${line.taxRate.toFixed()}% of taxable (${expectedTax.toFixed(2)})`, {
          rowRef: line.rowRef,
          field: "tax_amount"
        });
      } else if (taxGap.gt(PAISA)) {
        log.warning("TAX_ROUNDING", "voucher", `${voucher.number} line ${line.lineNo}: tax differs from the computed amount by ${taxGap.toFixed(2)}`, { rowRef: line.rowRef, field: "tax_amount" });
      }
    }
    if (voucher.type === "sales_return" || voucher.type === "purchase_return") {
      checkReturn(voucher, salesByKey, voucherKeys, returnedQty, log);
    }
  }
  checkBatches(bundle, allItems, log);

  // Settlements: bills must exist and must not be over-settled.
  const billTotals = new Map<string, { remaining: Decimal; party: string; date: string }>();
  for (const voucher of bundle.vouchers) {
    const total = voucher.lines.reduce((s, l) => s.add(l.taxableAmount).add(l.taxAmount), new D(0));
    if (voucher.type === "sales_invoice" || voucher.type === "purchase_invoice") {
      billTotals.set(voucher.key, { remaining: total, party: voucher.partyCode, date: voucher.date });
    }
  }
  for (const voucher of bundle.vouchers) {
    if ((voucher.type === "sales_return" || voucher.type === "purchase_return") && voucher.originalNumber) {
      const bill = billTotals.get(`${voucher.type === "sales_return" ? "sales_invoice" : "purchase_invoice"}|${voucher.originalNumber}`);
      if (bill) bill.remaining = bill.remaining.sub(voucher.lines.reduce((s, l) => s.add(l.taxableAmount).add(l.taxAmount), new D(0)));
    }
  }
  for (const settlement of bundle.settlements) {
    const billType = settlement.type === "receipt" ? "sales_invoice" : "purchase_invoice";
    const kind = partyKinds.get(settlement.partyCode);
    if (!kind) log.error("UNKNOWN_PARTY", "settlement", `${settlement.number}: party ${settlement.partyCode} is unknown`, { rowRef: settlement.allocations[0]?.rowRef });
    for (const allocation of settlement.allocations) {
      const key = `${billType}|${allocation.againstNumber}`;
      const bill = billTotals.get(key);
      if (!bill) {
        if (!known.voucherKeys.has(key)) {
          log.warning("UNKNOWN_BILL", "settlement", `${settlement.number}: bill ${allocation.againstNumber} not found; the amount is kept but not allocated`, {
            rowRef: allocation.rowRef,
            field: "against_voucher_no"
          });
        }
        continue;
      }
      if (bill.party !== settlement.partyCode) {
        log.error("BILL_PARTY_MISMATCH", "settlement", `${settlement.number}: bill ${allocation.againstNumber} belongs to ${bill.party}`, { rowRef: allocation.rowRef });
      }
      bill.remaining = bill.remaining.sub(allocation.amount);
      if (bill.remaining.lt(PAISA.neg())) {
        log.warning("OVER_SETTLED", "settlement", `${allocation.againstNumber} is settled beyond its amount by ${bill.remaining.neg().toFixed(2)}`, { rowRef: allocation.rowRef });
      }
    }
  }

  // Channel charges: orders should exist. Channel-only uploads link to orders in the books at
  // commit (by voucher number or marketplace order id) and report the match rate instead.
  for (const charge of bundle.kind === "books" ? bundle.charges : []) {
    if (charge.orderNumber && !voucherKeys.has(`sales_invoice|${charge.orderNumber}`)) {
      log.warning("UNKNOWN_ORDER", "channel_charge", `${charge.settlementRef}: order ${charge.orderNumber} not found; the charge is kept without an order link`, {
        rowRef: charge.rowRef,
        field: "order_voucher_no"
      });
    }
  }

  // Customer purchase orders reference known customers and items.
  for (const order of bundle.customerOrders) {
    const kind = partyKinds.get(order.partyCode);
    if (!kind) log.error("UNKNOWN_PARTY", "customer_order", `PO ${order.poNumber}: party ${order.partyCode} is not in the books`, { rowRef: order.rowRef, field: "party_code" });
    else if (kind === "supplier") log.error("PARTY_ROLE_MISMATCH", "customer_order", `PO ${order.poNumber}: ${order.partyCode} is a supplier`, { rowRef: order.rowRef, field: "party_code" });
    if (!allItems.has(order.itemCode)) log.error("UNKNOWN_ITEM", "customer_order", `PO ${order.poNumber}: item ${order.itemCode} is not in the books`, { rowRef: order.rowRef, field: "item_code" });
    if (order.qtySupplied.gt(order.qtyOrdered)) {
      log.warning("OVER_SUPPLIED", "customer_order", `PO ${order.poNumber}: ${order.itemCode} supplied ${order.qtySupplied} against ${order.qtyOrdered} ordered`, { rowRef: order.rowRef });
    }
  }

  // Snapshots reference known items / parties.
  for (const snap of bundle.stockSnapshots) {
    if (!allItems.has(snap.itemCode)) log.error("UNKNOWN_ITEM", "stock_snapshot", `item ${snap.itemCode} is unknown`, { rowRef: snap.rowRef, field: "item_code" });
  }
  for (const bill of bundle.outstanding) {
    if (!partyKinds.has(bill.partyCode)) log.error("UNKNOWN_PARTY", "outstanding", `party ${bill.partyCode} is unknown`, { rowRef: bill.rowRef, field: "party_code" });
  }

  return reconcileControlTotals(bundle, log);
}

function checkReturn(
  voucher: VoucherDraft,
  inBundle: Map<string, VoucherDraft>,
  allKeys: Set<string>,
  returnedQty: Map<string, Decimal>,
  log: IssueLog
): void {
  const firstRow = voucher.lines[0]?.rowRef;
  if (!voucher.originalNumber) {
    log.warning("RETURN_WITHOUT_ORIGINAL", "voucher", `${voucher.number}: return does not name the original invoice`, { rowRef: firstRow, field: "original_voucher_no" });
    return;
  }
  const originalKey = `${voucher.type === "sales_return" ? "sales_invoice" : "purchase_invoice"}|${voucher.originalNumber}`;
  if (!allKeys.has(originalKey)) {
    log.warning("UNKNOWN_ORIGINAL", "voucher", `${voucher.number}: original invoice ${voucher.originalNumber} not found`, { rowRef: firstRow, field: "original_voucher_no" });
    return;
  }
  const original = inBundle.get(originalKey);
  if (!original) return; // imported earlier; quantities checked when ledgers are rebuilt
  if (original.partyCode !== voucher.partyCode) {
    log.error("RETURN_PARTY_MISMATCH", "voucher", `${voucher.number}: party differs from original invoice ${voucher.originalNumber}`, { rowRef: firstRow, field: "party_code" });
  }
  if (original.date > voucher.date) {
    log.error("RETURN_BEFORE_SALE", "voucher", `${voucher.number}: dated before original invoice ${voucher.originalNumber}`, { rowRef: firstRow, field: "date" });
  }
  for (const line of voucher.lines) {
    const sold = original.lines.filter((l) => l.itemCode === line.itemCode).reduce((s, l) => s.add(l.qty), new D(0));
    const key = `${originalKey}|${line.itemCode}`;
    const total = (returnedQty.get(key) ?? new D(0)).add(line.qty);
    returnedQty.set(key, total);
    if (total.gt(sold)) {
      log.warning("RETURN_EXCEEDS_SALE", "voucher", `${voucher.number}: returns of ${line.itemCode} exceed the ${sold.toFixed()} sold on ${voucher.originalNumber}`, { rowRef: line.rowRef });
    }
  }
}

function reconcileControlTotals(bundle: ParsedBundle, log: IssueLog): ControlReconciliation {
  if (bundle.controlTotals.length === 0) {
    log.error("NO_CONTROL_TOTALS", "control_total", "control_totals.csv has no rows; imports must state totals to reconcile against");
    return [];
  }
  const periods = new Set(bundle.controlTotals.map((c) => `${c.from}|${c.to}`));
  if (periods.size > 1) {
    log.error("MIXED_PERIODS", "control_total", "All control totals must cover the same period");
    return [];
  }
  const [{ from, to }] = bundle.controlTotals;
  if (from > to) log.error("INVALID_VALUE", "control_total", "period_from is after period_to");
  for (const voucher of bundle.vouchers) {
    if (voucher.date < from || voucher.date > to) {
      log.error("OUTSIDE_PERIOD", "voucher", `${voucher.number} dated ${voucher.date} is outside the stated period ${from} to ${to}`, { rowRef: voucher.lines[0]?.rowRef, field: "date" });
    }
  }
  const computed = computeTotals(bundle);
  const seen = new Set<string>();
  const result: ControlReconciliation = [];
  for (const control of bundle.controlTotals) {
    if (seen.has(control.metric)) log.error("DUPLICATE_KEY", "control_total", `${control.metric} stated twice`, { rowRef: control.rowRef });
    seen.add(control.metric);
    const actual = computed[control.metric];
    const difference = actual.sub(control.value);
    const ok = difference.abs().lte(PAISA);
    result.push({ metric: control.metric, periodFrom: from, periodTo: to, stated: control.value.toFixed(2), computed: actual.toFixed(2), difference: difference.toFixed(2), ok });
    if (!ok) {
      log.error("CONTROL_TOTAL_MISMATCH", "control_total", `${control.metric}: rows add up to ${actual.toFixed(2)}, source states ${control.value.toFixed(2)} (difference ${difference.toFixed(2)})`, {
        rowRef: control.rowRef
      });
    }
  }
  for (const metric of CONTROL_TOTAL_METRICS) {
    if (!seen.has(metric)) log.warning("MISSING_CONTROL_TOTAL", "control_total", `No control total for ${metric}; it cannot be reconciled`);
  }
  return result;
}

/**
 * Batch and MRP checks (batch-tracked trades). Selling above MRP or after expiry is not allowed
 * in India, so both are flagged; they are warnings because the import must still reflect what the
 * books say.
 */
function checkBatches(bundle: ParsedBundle, allItems: Set<string>, log: IssueLog) {
  const expiryOf = new Map<string, { expiry: string; rowRef: string }>();
  const noteExpiry = (itemCode: string, batchNo: string, expiry: string | null | undefined, rowRef: string) => {
    if (!expiry) return;
    const key = `${itemCode}|${batchNo}`;
    const seen = expiryOf.get(key);
    if (!seen) expiryOf.set(key, { expiry, rowRef });
    else if (seen.expiry !== expiry) {
      log.warning("BATCH_EXPIRY_CONFLICT", "batch", `${itemCode} batch ${batchNo}: expiry ${expiry} differs from ${seen.expiry} given earlier; the first is kept`, { rowRef, field: "expiry_date" });
    }
  };

  // Opening stock by batch must add up to the item's opening quantity.
  const items = new Map(bundle.items.map((i) => [i.code, i]));
  const openingByItem = new Map<string, { qty: Decimal; value: Decimal | null; rowRef: string }>();
  const seen = new Set<string>();
  for (const b of bundle.batches) {
    const key = `${b.itemCode}|${b.batchNo}`;
    if (seen.has(key)) log.error("DUPLICATE_KEY", "batch", `${b.itemCode} batch ${b.batchNo} appears more than once`, { rowRef: b.rowRef });
    seen.add(key);
    if (!allItems.has(b.itemCode)) log.error("UNKNOWN_ITEM", "batch", `batch ${b.batchNo}: item ${b.itemCode} is not in items.csv or an earlier import`, { rowRef: b.rowRef, field: "item_code" });
    if (b.expiryDate && b.mfgDate && b.expiryDate < b.mfgDate) log.error("INVALID_VALUE", "batch", `${b.itemCode} batch ${b.batchNo}: expiry is before manufacture`, { rowRef: b.rowRef, field: "expiry_date" });
    noteExpiry(b.itemCode, b.batchNo, b.expiryDate, b.rowRef);
    const sum = openingByItem.get(b.itemCode) ?? { qty: new D(0), value: new D(0), rowRef: b.rowRef };
    sum.qty = sum.qty.add(b.openingQty);
    sum.value = sum.value === null || b.openingValue === null ? null : sum.value.add(b.openingValue);
    openingByItem.set(b.itemCode, sum);
  }
  for (const [code, sum] of openingByItem) {
    const item = items.get(code);
    if (!item) continue;
    if (!sum.qty.eq(item.openingQty)) {
      log.error("BATCH_OPENING_MISMATCH", "batch", `${code}: opening batches add up to ${sum.qty.toFixed()} but items.csv says ${item.openingQty.toFixed()}`, { rowRef: sum.rowRef, field: "opening_qty" });
    } else if (sum.value !== null && item.openingValue !== null && sum.value.sub(item.openingValue).abs().gt(PAISA)) {
      log.warning("BATCH_OPENING_VALUE_MISMATCH", "batch", `${code}: opening batch values add up to ${sum.value.toFixed(2)}, items.csv says ${item.openingValue.toFixed(2)}`, { rowRef: sum.rowRef, field: "opening_value" });
    }
  }

  for (const voucher of bundle.vouchers) {
    for (const line of voucher.lines) {
      if (line.batchNo) {
        noteExpiry(line.itemCode, line.batchNo, line.expiryDate, line.rowRef);
        if (voucher.type === "sales_invoice" && line.expiryDate && line.expiryDate < voucher.date) {
          log.warning("SOLD_AFTER_EXPIRY", "voucher", `${voucher.number}: ${line.itemCode} batch ${line.batchNo} sold on ${voucher.date}, after its expiry ${line.expiryDate}`, { rowRef: line.rowRef, field: "expiry_date" });
        }
      }
      if (voucher.type === "sales_invoice" && line.mrp && line.qty.gt(0)) {
        const unitInclTax = line.taxableAmount.add(line.taxAmount).div(line.qty);
        if (unitInclTax.sub(line.mrp).gt(PAISA)) {
          log.warning("ABOVE_MRP", "voucher", `${voucher.number}: ${line.itemCode} sold at ${unitInclTax.toFixed(2)} per unit incl. GST, above its MRP ${line.mrp.toFixed(2)}`, { rowRef: line.rowRef, field: "mrp" });
        }
      }
    }
  }
}
