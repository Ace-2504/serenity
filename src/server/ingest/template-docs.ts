import { toCsv } from "@/server/demo/csv";
import {
  CHANNEL_CHARGE_COLUMNS,
  CONTROL_TOTAL_COLUMNS,
  ITEM_COLUMNS,
  OUTSTANDING_COLUMNS,
  PARTY_COLUMNS,
  SETTLEMENT_COLUMNS,
  STOCK_SUMMARY_COLUMNS,
  TEMPLATE_FILES,
  VOUCHER_COLUMNS
} from "@/server/ingest/template";

type ColumnDoc = { column: string; required: boolean; meaning: string };
export type FileDoc = { file: string; required: boolean; purpose: string; columns: ColumnDoc[] };

const col = (column: string, required: boolean, meaning: string): ColumnDoc => ({ column, required, meaning });

/** Human documentation of the import template, shown on the template page. */
export const TEMPLATE_DOCS: FileDoc[] = [
  {
    file: TEMPLATE_FILES.items,
    required: true,
    purpose: "Stock items (Tally: Stock Items / Stock Summary with opening balances).",
    columns: [
      col("item_code", true, "Your code for the item; must be unique."),
      col("name", true, "Item name."),
      col("group", true, "Stock group or category."),
      col("uom", true, "Base unit, e.g. pcs, box, kg."),
      col("hsn_code", false, "HSN code."),
      col("gst_rate", false, "GST %, e.g. 12.00."),
      col("opening_qty", true, "Stock at the start of the period."),
      col("opening_value", false, "Value of opening stock at cost. Leave blank if unknown; cost of goods sold is then reported as unknown, never guessed."),
      col("attributes_json", false, 'Extra trade-specific fields as JSON, e.g. {"brand":"Likhit"}.')
    ]
  },
  {
    file: TEMPLATE_FILES.parties,
    required: true,
    purpose: "Customers and suppliers (Tally: Sundry Debtors / Creditors).",
    columns: [
      col("party_code", true, "Your code for the party; must be unique."),
      col("name", true, "Party name."),
      col("party_type", true, "customer, supplier or both."),
      col("segment", false, "e.g. school, retailer, office, marketplace."),
      col("city", false, ""),
      col("state_code", false, "GST state code."),
      col("gstin", false, ""),
      col("credit_days", false, "Agreed credit period in days."),
      col("phone", false, "Only used for campaigns the owner approves, with consent."),
      col("email", false, "As above."),
      col("buyer_identity", false, "anonymous for counter cash sales and marketplaces (excluded from customer analytics); default named.")
    ]
  },
  {
    file: TEMPLATE_FILES.vouchers,
    required: true,
    purpose: "Every sales, sales-return, purchase and purchase-return line in the period (Tally: Day Book with item details). One row per line.",
    columns: [
      col("voucher_type", true, "sales_invoice, sales_return, purchase_invoice or purchase_return."),
      col("voucher_no", true, "Voucher number; lines of one voucher share it."),
      col("date", true, "YYYY-MM-DD."),
      col("party_code", true, "Must exist in parties.csv or an earlier import."),
      col("channel", false, "direct, counter, own_web, amazon, meesho, blinkit, zepto, instamart, ..."),
      col("order_ref", false, "Marketplace order id."),
      col("due_date", false, "Payment due date for credit sales/purchases."),
      col("original_voucher_no", false, "For returns: the invoice being returned."),
      col("line_no", true, "1, 2, 3 ... within the voucher."),
      col("item_code", true, "Must exist in items.csv or an earlier import."),
      col("qty", true, "Quantity in the item's unit; greater than zero (returns are positive)."),
      col("rate", true, "Price per unit before discount, excluding GST."),
      col("discount_amount", false, "Discount on the line in rupees."),
      col("taxable_amount", true, "qty x rate - discount, checked to the paisa."),
      col("gst_rate", true, "GST %."),
      col("tax_amount", true, "GST on the line; differences up to Rs 1 from the computed amount are flagged, more is rejected."),
      col(
        "adjustment_incl_tax",
        false,
        "Bill-level amount that is not an item line: round-off, freight, packing (including any GST on it). Same value on every line of the voucher; added to the bill total only, not to sales."
      )
    ]
  },
  {
    file: TEMPLATE_FILES.controlTotals,
    required: true,
    purpose: "Totals from your accounting reports for the same period. The import is rejected unless the rows add up to these, and the database is checked against them before anything is saved.",
    columns: [
      col("metric", true, "sales_taxable, sales_tax, sales_return_taxable, purchase_taxable, purchase_return_taxable, receipts, payments, channel_charges."),
      col("period_from", true, "Start of the period; the file must contain every voucher in it."),
      col("period_to", true, "End of the period."),
      col("value", true, "Total in rupees.")
    ]
  },
  {
    file: TEMPLATE_FILES.settlements,
    required: false,
    purpose: "Receipts from customers and payments to suppliers, allocated to bills (Tally: bill-wise details).",
    columns: [
      col("voucher_type", true, "receipt or payment."),
      col("voucher_no", true, ""),
      col("date", true, ""),
      col("party_code", true, ""),
      col("against_voucher_no", true, "The invoice this amount settles; one row per bill."),
      col("amount", true, "Amount settled, including GST.")
    ]
  },
  {
    file: TEMPLATE_FILES.stockSummary,
    required: false,
    purpose: "Closing stock reported by your accounting software, used to reconcile the stock ledger.",
    columns: [col("item_code", true, ""), col("as_of", true, ""), col("qty", true, ""), col("value", false, ""), col("valuation_method", false, "e.g. weighted_average, fifo.")]
  },
  {
    file: TEMPLATE_FILES.outstanding,
    required: false,
    purpose: "Bills outstanding (receivables and payables) as on a date.",
    columns: [
      col("party_code", true, ""),
      col("side", true, "receivable or payable."),
      col("bill_ref", true, ""),
      col("bill_date", true, ""),
      col("due_date", false, ""),
      col("amount_incl_tax", true, ""),
      col("pending_incl_tax", true, ""),
      col("as_of", true, "")
    ]
  },
  {
    file: TEMPLATE_FILES.channelCharges,
    required: false,
    purpose: "Fees and taxes a marketplace or payment gateway deducted from its payouts (from settlement reports).",
    columns: [
      col("channel", true, ""),
      col("settlement_ref", true, ""),
      col("settlement_date", true, ""),
      col("order_voucher_no", false, "Your sales voucher for the order; blank for period-level lines such as TDS."),
      col("charge_type", true, "e.g. referral_fee, closing_fee, shipping_fee, payment_gateway_fee, tcs_gst, tds_income_tax."),
      col("amount", true, "Excluding GST on the fee. tcs_gst and tds_income_tax are tax credits, not costs."),
      col("gst_amount", false, "GST charged on the fee.")
    ]
  }
];

/** Example CSV per file: header plus one consistent example row. */
export const TEMPLATE_EXAMPLES: Record<string, string> = {
  [TEMPLATE_FILES.items]: toCsv(ITEM_COLUMNS, [
    { item_code: "NB-1", name: "Ruled notebook A5", group: "Notebooks", uom: "pcs", hsn_code: "4820", gst_rate: "12.00", opening_qty: "100", opening_value: "2500.00", attributes_json: '{"brand":"Likhit"}' }
  ]),
  [TEMPLATE_FILES.parties]: toCsv(PARTY_COLUMNS, [
    { party_code: "C1", name: "Example Stationers", party_type: "customer", segment: "retailer", city: "Noida", state_code: "09", gstin: "", credit_days: "30", phone: "", email: "", buyer_identity: "named" }
  ]),
  [TEMPLATE_FILES.vouchers]: toCsv(VOUCHER_COLUMNS, [
    {
      voucher_type: "sales_invoice",
      voucher_no: "SI-1",
      date: "2026-04-10",
      party_code: "C1",
      channel: "direct",
      order_ref: "",
      due_date: "2026-05-10",
      original_voucher_no: "",
      line_no: "1",
      item_code: "NB-1",
      qty: "10",
      rate: "40.00",
      discount_amount: "20.00",
      taxable_amount: "380.00",
      gst_rate: "12.00",
      tax_amount: "45.60",
      adjustment_incl_tax: "0.40"
    }
  ]),
  [TEMPLATE_FILES.controlTotals]: toCsv(
    CONTROL_TOTAL_COLUMNS,
    [
      ["sales_taxable", "380.00"],
      ["sales_tax", "45.60"],
      ["sales_return_taxable", "0.00"],
      ["purchase_taxable", "0.00"],
      ["purchase_return_taxable", "0.00"],
      ["receipts", "0.00"],
      ["payments", "0.00"],
      ["channel_charges", "0.00"]
    ].map(([metric, value]) => ({ metric, period_from: "2026-04-01", period_to: "2026-04-30", value }))
  ),
  [TEMPLATE_FILES.settlements]: toCsv(SETTLEMENT_COLUMNS, []),
  [TEMPLATE_FILES.stockSummary]: toCsv(STOCK_SUMMARY_COLUMNS, []),
  [TEMPLATE_FILES.outstanding]: toCsv(OUTSTANDING_COLUMNS, []),
  [TEMPLATE_FILES.channelCharges]: toCsv(CHANNEL_CHARGE_COLUMNS, [])
};
