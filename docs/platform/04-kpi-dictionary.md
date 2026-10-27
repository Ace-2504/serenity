# 04 — KPI Dictionary

This is the authoritative definition list. The code registry (`src/server/metrics/registry.ts`) must match it, and a test fails if a registered metric has no entry here.

## Conventions

* **Currency**: INR, `Decimal(18,2)`. **Revenue and cost exclude GST** (GST collected is a liability, and input GST is recoverable for a registered dealer). Receivables and payables **include** GST, because that is what the party owes.
* **Period** `[from, to]` is inclusive, by voucher date; *days(P)* = calendar days in the period. Default comparison: previous period of equal length, plus the same period last year.
* **Active vouchers only** (`status = active`).
* **Status semantics**: each metric returns `ok`, `partial` (some inputs missing; coverage % shown) or `unavailable` (with the data required).
* "Customer" means a `Party` with at least one sales voucher.

## A. Sales & profitability

| ID | Metric | Formula | Unit | Required source data | Notes / assumptions |
|---|---|---|---|---|---|
| `units_sold` | Units sold | Σ qty (sales_invoice lines) − Σ qty (sales_return lines) | base UoM | sales vouchers with item lines | Not summed across items with different UoM |
| `gross_sales` | Gross sales | Σ qty × rate on sales_invoice lines | ₹ | item lines | Before discounts |
| `discounts` | Discounts | Σ line discount + allocated invoice discount (sales_invoice) | ₹ | discount fields | Invoice-level discount allocated pro-rata by gross |
| `sales_returns` | Sales returns | Σ taxable value of sales_return vouchers dated in P | ₹ | credit notes with items | Return is booked in the period of the credit note, not the original sale |
| `net_sales` | Net sales | gross_sales − discounts − sales_returns | ₹ | — | Equals Σ taxable(sales) − Σ taxable(returns) |
| `cogs` | Cost of goods sold | Σ cost of qty sold (WAC at sale) − Σ cost of qty returned | ₹ | purchases (cost), opening stock, or source-provided cost | `partial` if any line has `costBasis = unknown`; coverage % = net sales with known cost ÷ net sales |
| `gross_profit` | Gross profit | net_sales − cogs | ₹ | as cogs | Only computed over lines with known cost; never assumes zero cost |
| `gross_margin_pct` | Gross margin % | gross_profit ÷ net_sales (known-cost lines) | % | — | |
| `contribution` | Contribution | gross_profit − variable selling costs (freight-out, payment/marketplace fees, sales commission) | ₹ | **mapped expense ledgers** | `unavailable` until variable-cost ledgers are mapped. The UI then shows gross profit, labelled as such, and **never calls it contribution** |
| `contribution_margin_pct` | Contribution margin % | contribution ÷ net_sales | % | as above | |
| `channel_charges` | Channel charges | Σ ChannelCharge.amount where not tax-withheld, allocated to orders/lines by order-value share | ₹ | settlement reports | GST on fees excluded (input credit for a registered seller); TCS/TDS excluded (tax credits) |
| `channel_contribution` | Contribution by channel / SKU | net_sales − cogs − channel_charges (− freight-out where mapped) | ₹ | as above | Available per channel as soon as that channel's charges are imported; otherwise `unavailable` for that channel |
| `operating_profit` | Operating profit | contribution − fixed operating expenses | ₹ | all indirect expense ledgers | Out of MVP scope; shown as `unavailable` |
| `discount_rate` | Discount rate | discounts ÷ gross_sales | % | | |
| `return_rate` | Return rate | sales_returns ÷ (net_sales + sales_returns) | % | | Value-based |
| `net_sales_growth` | Net sales growth | net_sales(P) ÷ net_sales(P_prev) − 1 | % | two periods | |

## B. Orders & customers

| ID | Metric | Formula | Notes |
|---|---|---|---|
| `invoice_count` | Orders | count of sales_invoice vouchers | An "order" is an invoice; storefront orders map 1:1 |
| `aov` | Average order value | Σ taxable(sales_invoice) ÷ invoice_count | Before returns, excluding GST |
| `median_order_value` | Median order value | median of invoice taxable values | Robust to bulk orders |
| `units_per_order` | Units per order | Σ qty ÷ invoice_count | Mixed UoM caveat |
| `orders_per_customer` | Orders per customer | invoice_count ÷ distinct customers | |
| `repeat_purchase_rate` | Repeat purchase rate | customers with ≥ 2 invoices in P ÷ customers with ≥ 1 | Sensitive to period length; always shown with the period |
| `top_n_share` | Customer concentration (top N) | Σ net_sales of top N customers ÷ net_sales | N = 5 and 10 |
| `hhi_customers` | Herfindahl index | Σ (customer share)² × 10,000 | > 2,500 = highly concentrated (convention borrowed from antitrust) |
| `discounted_order_share` | Discounted-order share | invoices with discount > 0 ÷ invoice_count | |
| `basket_pair_lift` | Pair lift | P(A∧B) ÷ (P(A)·P(B)) over invoices | Reported only with support ≥ configured minimum (default 20 invoices) |
| `fill_rate` | Fill rate (quick commerce / B2B POs) | units supplied ÷ units ordered on purchase orders | Needs PO quantities from the platform (PO/GRN exports); `unavailable` from invoices alone |
| `payout_lag_days` | Marketplace payout lag | mean(payout date − order date), by channel | From settlement reports; actual dates, not assumed cycles |

## C. Inventory

| ID | Metric | Formula | Required data | Notes |
|---|---|---|---|---|
| `inventory_value` | Inventory value (at cost) | Σ runningValue at date | stock ledger, or StockSnapshot value | Valuation: weighted average cost (WAC) by default. If a source snapshot exists, it is shown with the variance vs derived |
| `avg_inventory` | Average inventory at cost | mean of month-end inventory values within P (incl. opening) | ≥ 2 points | Falls back to (opening + closing) ÷ 2, labelled; `unavailable` with < 2 points |
| `inventory_turnover` | Inventory turnover | cogs(P) ÷ avg_inventory(P) | | **Cost-based only. Never revenue ÷ inventory.** `unavailable` if cogs is unavailable |
| `dio` | Days inventory outstanding | avg_inventory ÷ cogs × days(P) | | |
| `days_since_last_sale` | Days since last sale | asOf − max(sale date) per item | | "Never sold" is shown separately |
| `stock_age_buckets` | Stock ageing | on-hand quantity attributed to inward layers FIFO; value by age 0–30/31–90/91–180/181–365/>365 days | stock ledger | FIFO layers are used **only for ageing**, while valuation stays WAC. This is stated in the UI |
| `slow_moving_value` | Slow-moving stock value | Σ inventory_value of items with days_since_last_sale ≥ T_slow (default 90) | | T configurable per tenant |
| `dead_stock_value` | Non-moving stock value | Σ value where no sale in ≥ T_dead (default 180) or never sold and age > T_dead | | |
| `sell_through` | Sell-through | units_sold ÷ (units_sold + closing qty) | | |
| `stockout_days` | Stockout days | days in P where runningQty ≤ 0 and the item had demand in the trailing 90 days | daily ledger | Historical only; needs movement history, not just snapshots |
| `reorder_point` | Reorder point | d̄ × L + z × σ_d × √L | demand history, lead time L | d̄, σ_d from daily demand over the trailing 90 days; L from supplier settings or the observed purchase-order gap (labelled); z = 1.65 (95 % service) by default. Intermittent demand (> 50 % zero days) → flagged as low-confidence |
| `weeks_of_cover` | Weeks of cover | on-hand qty ÷ avg weekly units sold (trailing 12 weeks) | | |

## D. Working capital

| ID | Metric | Formula | Notes |
|---|---|---|---|
| `ar_total` | Trade receivables | Σ pendingInclTax of receivable bills at asOf | From OutstandingSnapshot; if absent, from the ledger with FIFO allocation (labelled) |
| `ar_ageing` | AR ageing | pending by days past **due date** in buckets: not due / 1–30 / 31–60 / 61–90 / > 90 | If dueDate is missing → billDate + party creditDays → tenant default (labelled) |
| `overdue_ar` | Overdue receivables | Σ pending where asOf > dueDate | |
| `dso` | Days sales outstanding | avg AR ÷ credit sales incl. GST(P) × days(P) | Numerator and denominator are both GST-inclusive for consistency. Avg AR = mean of available AR points in P |
| `ap_total`, `ap_ageing` | Trade payables, ageing | as AR, on payable bills | |
| `dpo` | Days payable outstanding | avg AP ÷ credit purchases incl. GST(P) × days(P) | Uses purchases, not COGS, for a GST-consistent trading-business denominator. Documented deviation from the COGS-based textbook form |
| `ccc` | Cash conversion cycle | dio + dso − dpo | `unavailable` if any component is unavailable; components always shown |
| `wc_trade` | Trade working capital | inventory_value + ar_total − ap_total | Inventory ex-GST, AR/AP incl. GST, stated in the UI |
| `cash_release_collections` | Scenario: cash released by faster collection | ar_total − (target_dso ÷ current_dso) × ar_total | Scenario. Assumes the same sales volume and mix |
| `cash_release_inventory` | Scenario: cash released by cutting slow stock | x % × slow_moving_value × expected recovery % | Owner-set recovery %; never defaulted to 100 % |

## E. ML & campaign metrics

| ID | Metric | Definition |
|---|---|---|
| `p_repurchase_90d` | Repeat-purchase probability | P(customer places ≥ 1 sales invoice in (asOf, asOf + 90d]), from a calibrated model; shown with version and asOf |
| `forecast_mase` | Forecast error (MASE) | MAE(model) ÷ MAE(seasonal-naive) on a rolling-origin backtest; < 1 means it beats the baseline |
| `forecast_wape` | WAPE | Σ abs error ÷ Σ actual (item × week) |
| `brier` | Brier score | mean (p − y)², with the base-rate Brier for reference |
| `campaign_conversion` | Conversion | buyers within the window ÷ audience size, per group |
| `campaign_uplift` | Incremental conversion | conv(treatment) − conv(holdout), with a 95 % interval (Wilson / bootstrap) |
| `campaign_incremental_gp` | Incremental gross profit | (GP per treated customer − GP per holdout customer) × treated count | "Not significant" is shown when the interval crosses 0 |
| `reactivation_rate` | Customer reactivation | lapsed customers (no purchase ≥ T days) who purchase in the window ÷ lapsed customers targeted |

## F. Platform KPIs

| ID | Definition |
|---|---|
| `import_success_rate` | committed batches ÷ attempted batches (30d) |
| `reconciliation_discrepancy_rate` | batches with any control-total variance > ₹1 ÷ committed batches |
| `data_freshness_hours` | now − lastSuccessfulSyncAt per source |
| `report_latency_p95` | p95 server time of metric endpoints |
| `finding_review_rate` | findings with status ≠ open ÷ findings created (30d) |
| `finding_acceptance_rate` | accepted ÷ reviewed |
| `realised_impact_inr` | Σ FindingOutcome.realisedImpactInr. **Reported separately from estimated impact; never summed with it** |
| `assistant_guard_pass_rate` | answers passing the numeric guard ÷ answers |
| `model_calibration_ece` | expected calibration error of the latest model on the latest held-out window |
