/**
 * The Serenity import template: the file set a business (or the demo generator) supplies.
 * Shapes mirror what accounting packages report: masters, a day book of vouchers,
 * settlements against bills, a stock summary, bills outstanding and control totals.
 *
 * All amounts are rupees with two decimals, written as strings ("1234.50") so that no
 * floating-point value ever enters the pipeline. Amounts exclude GST unless the column
 * name says incl_tax. Dates are ISO yyyy-mm-dd.
 */

export const TEMPLATE_FILES = {
  items: "items.csv",
  parties: "parties.csv",
  vouchers: "vouchers.csv",
  settlements: "settlements.csv",
  stockSummary: "stock_summary.csv",
  outstanding: "outstanding.csv",
  channelCharges: "channel_charges.csv",
  controlTotals: "control_totals.csv"
} as const;

export const ITEM_COLUMNS = [
  "item_code",
  "name",
  "group",
  "uom",
  "hsn_code",
  "gst_rate",
  "opening_qty",
  "opening_value",
  "attributes_json"
] as const;

export const PARTY_COLUMNS = [
  "party_code",
  "name",
  "party_type",
  "segment",
  "city",
  "state_code",
  "gstin",
  "credit_days",
  "phone",
  "email"
] as const;

/** One row per voucher line; header fields repeat on every line of the voucher. */
export const VOUCHER_COLUMNS = [
  "voucher_type",
  "voucher_no",
  "date",
  "party_code",
  "channel",
  "order_ref",
  "due_date",
  "original_voucher_no",
  "line_no",
  "item_code",
  "qty",
  "rate",
  "discount_amount",
  "taxable_amount",
  "gst_rate",
  "tax_amount"
] as const;

/** One row per bill allocation; a receipt settling three bills has three rows. */
export const SETTLEMENT_COLUMNS = ["voucher_type", "voucher_no", "date", "party_code", "against_voucher_no", "amount"] as const;

export const STOCK_SUMMARY_COLUMNS = ["item_code", "as_of", "qty", "value", "valuation_method"] as const;

export const OUTSTANDING_COLUMNS = [
  "party_code",
  "side",
  "bill_ref",
  "bill_date",
  "due_date",
  "amount_incl_tax",
  "pending_incl_tax",
  "as_of"
] as const;

/**
 * Deductions a sales channel (marketplace, payment gateway) makes from what it pays out,
 * one row per charge per order. charge_type "tcs_gst" and "tds_income_tax" are tax withheld
 * at source: claimable credits that affect cash, not costs. gst_amount is GST charged on the
 * fee itself (input credit for a registered seller, so also not a cost).
 */
export const CHANNEL_CHARGE_COLUMNS = [
  "channel",
  "settlement_ref",
  "settlement_date",
  "order_voucher_no",
  "charge_type",
  "amount",
  "gst_amount"
] as const;

export const TAX_WITHHELD_CHARGE_TYPES = ["tcs_gst", "tds_income_tax"] as const;

export const CONTROL_TOTAL_COLUMNS = ["metric", "period_from", "period_to", "value"] as const;

export const CONTROL_TOTAL_METRICS = [
  "sales_taxable",
  "sales_tax",
  "sales_return_taxable",
  "purchase_taxable",
  "purchase_return_taxable",
  "receipts",
  "payments",
  "channel_charges"
] as const;

export type ItemRow = Record<(typeof ITEM_COLUMNS)[number], string>;
export type PartyRow = Record<(typeof PARTY_COLUMNS)[number], string>;
export type VoucherRow = Record<(typeof VOUCHER_COLUMNS)[number], string>;
export type SettlementRow = Record<(typeof SETTLEMENT_COLUMNS)[number], string>;
export type StockSummaryRow = Record<(typeof STOCK_SUMMARY_COLUMNS)[number], string>;
export type OutstandingRow = Record<(typeof OUTSTANDING_COLUMNS)[number], string>;
export type ChannelChargeRow = Record<(typeof CHANNEL_CHARGE_COLUMNS)[number], string>;
export type ControlTotalRow = Record<(typeof CONTROL_TOTAL_COLUMNS)[number], string>;

export type TemplateVoucherType = "sales_invoice" | "sales_return" | "purchase_invoice" | "purchase_return";
export type TemplateSettlementType = "receipt" | "payment";

/** Formats integer paise as a rupee string with exactly two decimals. */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Amount must be an integer number of paise, got ${paise}`);
  }

  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parses a rupee string ("12", "12.5", "12.50") into integer paise without floating point. */
export function parsePaise(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Not a rupee amount: "${value}"`);
  }

  const [, minus, whole, fraction = ""] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minus ? -paise : paise;
}
