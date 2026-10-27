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
  { id: "stockout_days", label: "Stockout days", unit: "days", formula: "Days in the period with no stock left while the item had sold in the previous 90 days." }
];

export const metricById = (id: string) => METRICS.find((m) => m.id === id);
