/**
 * Metrics the product shows, with the definition the owner sees on /bi/metrics.
 * Every id must have an entry in docs/platform/04-kpi-dictionary.md (enforced by a test).
 */
export type MetricDef = { id: string; label: string; unit: "INR" | "%" | "ratio" | "days" | "count" | "units"; formula: string; notes?: string };

export const METRICS: MetricDef[] = [
  { id: "gross_sales", label: "Gross sales", unit: "INR", formula: "Sum of quantity × rate on sales invoices in the period, before discounts, excluding GST." },
  { id: "discounts", label: "Discounts", unit: "INR", formula: "Line discounts plus each invoice-level discount spread over its lines by value." },
  { id: "sales_returns", label: "Sales returns", unit: "INR", formula: "Taxable value of credit notes dated in the period.", notes: "A return counts in the period of the credit note, not of the original sale." },
  { id: "net_sales", label: "Net sales", unit: "INR", formula: "Gross sales − discounts − sales returns." },
  { id: "cogs", label: "Cost of goods sold", unit: "INR", formula: "Weighted-average cost of units sold, minus the cost restored by returns.", notes: "Lines whose cost is unknown are excluded, never counted at zero cost." },
  { id: "gross_profit", label: "Gross profit", unit: "INR", formula: "Net sales on lines with known cost − cost of goods sold." },
  { id: "gross_margin_pct", label: "Gross margin", unit: "%", formula: "Gross profit ÷ net sales on lines with known cost." },
  {
    id: "channel_charges",
    label: "Channel charges",
    unit: "INR",
    formula: "Marketplace and payment-gateway fees for an order, spread over its lines by value.",
    notes: "GST on fees and tax withheld (TCS/TDS) are credits, not costs, and are excluded."
  },
  { id: "channel_contribution", label: "Contribution", unit: "INR", formula: "Gross profit − channel charges.", notes: "Other variable costs (freight, commissions) are included once their ledgers are mapped." },
  { id: "inventory_value", label: "Inventory value", unit: "INR", formula: "Quantity on hand × weighted-average cost, as on the date." },
  { id: "avg_inventory", label: "Average inventory", unit: "INR", formula: "Mean of inventory value at the period's opening, each month end, and its closing date." },
  { id: "inventory_turnover", label: "Inventory turnover", unit: "ratio", formula: "Cost of goods sold ÷ average inventory at cost.", notes: "Never computed from sales revenue." },
  { id: "dio", label: "Days inventory outstanding", unit: "days", formula: "Average inventory ÷ cost of goods sold × days in the period." },
  { id: "days_since_last_sale", label: "Days since last sale", unit: "days", formula: "Days from the item's last sales invoice to the as-of date." },
  { id: "stock_age_buckets", label: "Stock ageing", unit: "INR", formula: "Units on hand matched to the most recent receipts (first in, first out) to find their age; valued at weighted-average cost." },
  { id: "slow_moving_value", label: "Slow-moving stock", unit: "INR", formula: "Value of items with no sale for at least the slow-moving threshold of your trade (stationery: 90 days)." },
  { id: "dead_stock_value", label: "Non-moving stock", unit: "INR", formula: "Value of items with no sale for at least the non-moving threshold (stationery: 180 days), or never sold." },
  { id: "ar_total", label: "Trade receivables", unit: "INR", formula: "Bills to customers (incl. GST) − credit notes against them − receipts allocated to them, as on the date." },
  { id: "ap_total", label: "Trade payables", unit: "INR", formula: "Supplier bills (incl. GST) − debit notes − payments allocated to them, as on the date." },
  { id: "dso", label: "Days sales outstanding", unit: "days", formula: "Average receivables ÷ credit sales incl. GST × days in the period.", notes: "A credit sale is a sales invoice not fully settled on its own date." },
  { id: "dpo", label: "Days payable outstanding", unit: "days", formula: "Average payables ÷ credit purchases incl. GST × days in the period." },
  { id: "ccc", label: "Cash conversion cycle", unit: "days", formula: "Days of inventory + days to collect − days to pay." },
  { id: "wc_trade", label: "Trade working capital", unit: "INR", formula: "Inventory at cost + receivables − payables.", notes: "Inventory excludes GST; receivables and payables include it." },
  { id: "repeat_purchase_rate", label: "Repeat purchase rate", unit: "%", formula: "Named customers with 2+ invoices in the period ÷ named customers with 1+." },
  { id: "aov", label: "Average order value", unit: "INR", formula: "Taxable value of sales invoices ÷ number of invoices (before returns, excluding GST)." },
  { id: "top_n_share", label: "Top buyers' share", unit: "%", formula: "Net sales of the top 5 (and 10) buyers ÷ net sales. A marketplace counts as one buyer." },
  {
    id: "lapsing_customer",
    label: "Lapsing customer",
    unit: "count",
    formula: "A valuable customer (3+ orders, lifetime value in the top 60%) silent for over 30 days and over twice their usual gap, during months in which they normally buy.",
    notes: "Season-aware: a school in its usual off-season is not lapsing; one that skipped a season is."
  },
  { id: "stockout_days", label: "Stockout days", unit: "days", formula: "Days in the period with no stock left while the item had sold in the previous 90 days." }
];

export const metricById = (id: string) => METRICS.find((m) => m.id === id);
