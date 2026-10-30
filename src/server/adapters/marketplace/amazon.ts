import { Prisma } from "@prisma/client";
import { column, looseDate, looseMoney, money, type Table } from "@/server/adapters/marketplace/table";
import type { Issue } from "@/server/ingest/issues";
import type { ChannelChargeRow } from "@/server/ingest/template";

/**
 * Amazon Settlement Report V2 (flat file, tab-separated) -> channel charges.
 *
 * Column names follow Amazon's documented V2 flat-file layout (settlement-id, deposit-date,
 * total-amount, transaction-type, order-id, amount-type, amount-description, amount, ...).
 * The amount-description values for India's fees and tax lines are taken from public samples
 * and are NOT verified against a real Amazon.in file: unrecognised descriptions are kept as
 * "other_fee" and listed, never dropped.
 *
 *  - ItemPrice / Promotion lines are the sale itself (already in the books): not charges.
 *  - Fee lines become charges (positive = deducted). GST on a fee is merged into gst_amount of
 *    the fee it belongs to.
 *  - TCS (GST) and TDS (income tax) withheld are tax credits: charge types tcs_gst / tds_income_tax.
 *  - Each settlement's rows must add up to its deposit (total-amount), or the file is rejected.
 */

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export const AMAZON_COLUMNS = {
  settlementId: ["settlement-id"],
  start: ["settlement-start-date"],
  end: ["settlement-end-date"],
  deposit: ["deposit-date"],
  total: ["total-amount"],
  transactionType: ["transaction-type"],
  orderId: ["order-id"],
  amountType: ["amount-type"],
  description: ["amount-description"],
  amount: ["amount"],
  postedDate: ["posted-date"]
} as const;

export const isAmazonSettlement = (t: Table) => column(t.header, AMAZON_COLUMNS.settlementId) >= 0 && column(t.header, AMAZON_COLUMNS.description) >= 0;

const GST_SUFFIX = /[\s_-]*(cgst|sgst|igst|utgst|gst|tax)$/i;
const FEES: [RegExp, string][] = [
  [/refund ?commission|refund ?administration/i, "refund_admin_fee"],
  [/commission|referral/i, "referral_fee"],
  [/closing ?fee|fixed ?closing/i, "closing_fee"],
  [/weight ?handling|shipping ?charge ?back|shipping ?fee|easy ?ship|delivery ?service/i, "shipping_fee"],
  [/fba|fulfil|pick ?(&|and) ?pack/i, "fba_fee"],
  [/technology/i, "technology_fee"],
  [/storage/i, "storage_fee"],
  [/advertis|sponsored/i, "advertising_fee"]
];

type ChargeKey = string; // settlement|order|type
export type AmazonConversion = { rows: ChannelChargeRow[]; issues: Issue[]; deposits: { settlementId: string; depositDate: string; total: string }[]; breakdown: Record<string, string> };

export function convertAmazonSettlements(tables: Table[]): AmazonConversion {
  const issues: Issue[] = [];
  const charges = new Map<ChargeKey, { settlementId: string; date: string; order: string; type: string; amount: Decimal; gst: Decimal; label: string }>();
  const deposits: AmazonConversion["deposits"] = [];
  const breakdown = { sales_collected: new D(0), fees: new D(0), fee_gst: new D(0), tax_withheld: new D(0), other: new D(0) };
  const unknown = new Map<string, Decimal>();

  for (const t of tables) {
    const col = Object.fromEntries(Object.entries(AMAZON_COLUMNS).map(([k, aliases]) => [k, column(t.header, aliases)])) as Record<keyof typeof AMAZON_COLUMNS, number>;
    const get = (row: string[], k: keyof typeof AMAZON_COLUMNS) => (col[k] >= 0 ? (row[col[k]] ?? "") : "");
    // The first row with a deposit total is the settlement summary; the rest are transactions.
    const bySettlement = new Map<string, { deposit: string; total: Decimal | null; sum: Decimal }>();
    t.rows.forEach((row, i) => {
      const ref = `${t.file}:${i + 2}`;
      const id = get(row, "settlementId");
      if (!id) return;
      const s = bySettlement.get(id) ?? { deposit: "", total: null, sum: new D(0) };
      bySettlement.set(id, s);
      if (!get(row, "transactionType") && get(row, "total")) {
        s.total = looseMoney(get(row, "total"));
        s.deposit = looseDate(get(row, "deposit")) ?? "";
        if (!s.deposit) issues.push({ severity: "error", code: "AMAZON_BAD_DATE", entity: "channel_charge", rowRef: ref, message: `Settlement ${id}: deposit date "${get(row, "deposit")}" not understood` });
        return;
      }
      const amount = looseMoney(get(row, "amount"));
      if (amount === null) {
        issues.push({ severity: "error", code: "AMAZON_BAD_AMOUNT", entity: "channel_charge", rowRef: ref, message: `amount "${get(row, "amount")}" is not a number` });
        return;
      }
      s.sum = s.sum.add(amount);
      const amountType = get(row, "amountType");
      const description = get(row, "description");
      const order = get(row, "orderId");
      if (/^(itemprice|promotion)$/i.test(amountType)) {
        breakdown.sales_collected = breakdown.sales_collected.add(amount);
        return;
      }
      let type: string;
      let isGst = false;
      if (/tcs/i.test(description) || /withheld/i.test(amountType)) type = "tcs_gst";
      else if (/tds|194-?o/i.test(description)) type = "tds_income_tax";
      else {
        isGst = GST_SUFFIX.test(description) && !/^tax$/i.test(description);
        const base = description.replace(GST_SUFFIX, "");
        const match = FEES.find(([re]) => re.test(base));
        type = match ? match[1] : "other_fee";
        if (!match) unknown.set(`${amountType} / ${description}`, (unknown.get(`${amountType} / ${description}`) ?? new D(0)).add(amount));
      }
      const charge = amount.neg(); // deductions are negative in the file; charges are positive
      if (type === "tcs_gst" || type === "tds_income_tax") breakdown.tax_withheld = breakdown.tax_withheld.add(amount);
      else if (isGst) breakdown.fee_gst = breakdown.fee_gst.add(amount);
      else if (type === "other_fee") breakdown.other = breakdown.other.add(amount);
      else breakdown.fees = breakdown.fees.add(amount);
      const key = `${id}|${order}|${type}`;
      const entry = charges.get(key) ?? { settlementId: id, date: "", order, type, amount: new D(0), gst: new D(0), label: description };
      if (isGst) entry.gst = entry.gst.add(charge);
      else entry.amount = entry.amount.add(charge);
      charges.set(key, entry);
    });
    for (const [id, s] of bySettlement) {
      if (s.total === null) {
        issues.push({ severity: "error", code: "AMAZON_NO_SUMMARY", entity: "channel_charge", message: `${t.file}: settlement ${id} has no summary row with total-amount and deposit-date` });
        continue;
      }
      if (!s.sum.sub(s.total).abs().lte(0.01)) {
        issues.push({
          severity: "error",
          code: "AMAZON_PAYOUT_MISMATCH",
          entity: "channel_charge",
          message: `Settlement ${id}: rows add up to ${money(s.sum)} but the deposit is ${money(s.total)}; the file may be incomplete`
        });
      }
      deposits.push({ settlementId: id, depositDate: s.deposit, total: money(s.total) });
      for (const c of charges.values()) if (c.settlementId === id) c.date = s.deposit;
    }
  }
  for (const [label, total] of unknown) {
    issues.push({ severity: "warning", code: "AMAZON_UNKNOWN_FEE", entity: "channel_charge", message: `Unrecognised line "${label}" (${money(total)}) kept as other_fee` });
  }

  const rows: ChannelChargeRow[] = [...charges.values()]
    .filter((c) => c.date && !(c.amount.isZero() && c.gst.isZero()))
    .map((c) => ({
      channel: "amazon",
      settlement_ref: c.settlementId,
      settlement_date: c.date,
      // TDS is reported per period; storage, ads and subscriptions are not tied to an order.
      order_voucher_no: c.type === "tds_income_tax" || ["storage_fee", "advertising_fee"].includes(c.type) ? "" : c.order,
      charge_type: c.type,
      amount: money(c.amount),
      gst_amount: money(c.gst)
    }));
  return { rows, issues, deposits, breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, money(v)])) };
}
