# 01 — Product Specification

Working name: **Serenity BI**, operations intelligence for Indian trading SMEs.

## 1. Target user

**Primary persona: owner of a stationery / school-supplies distributor.** Turnover is roughly ₹2–25 crore, with 300–3,000 active SKUs and 100–2,000 B2B customers (retailers, schools, offices). Books are kept in TallyPrime or BUSY by an in-house accountant or an external CA. The owner reads reports in Tally but doesn't build them, and decides purchasing, credit and discounts on instinct.

**Sales channels (B2B and B2C).** The same business typically sells through several channels at once, and the product treats each as a first-class dimension:

| Channel | Examples | Economics the product must capture |
|---|---|---|
| Direct B2B | schools, retailers, offices | credit terms, bulk orders, receivables |
| Quick commerce | Blinkit (inventory-led since Sep 2025), Zepto, Instamart | B2B sale to the platform against purchase orders; fill rate; payment terms |
| Marketplace B2C | Amazon.in, Meesho | per-order fees, shipping, returns/RTO, payouts net of fees, TCS/TDS withheld |
| Own B2C | Serenity storefront, shop counter | payment-gateway fees, cash |

Channel fees and returns are what turn gross profit into **contribution**, so "which SKUs lose money on which channel" is a core question, not an add-on.

**Secondary persona: accountant / operations manager.** Runs the imports, resolves validation errors and owns data quality.

**Initial vertical:** stationery and school supplies, because of strong seasonality (back-to-school, exam season, Diwali), many SKUs, B2B credit sales and slow-moving stock risk. The model is not stationery-specific. Electrical and hardware wholesale has the same shape.

## 2. The problem in one paragraph

The owner has years of vouchers in Tally and cannot answer:

* Which SKUs actually make money after discounts and returns?
* How much cash is sitting in stock that hasn't moved since last season?
* Which customers are paying slower than last year?
* Which schools ordered last June and haven't reordered?

Tally's reports are period- and ledger-oriented. They don't rank, compare, explain or recommend.

## 3. Five questions → features → decisions

| Question | Feature | Decision it supports |
|---|---|---|
| **Profitability:** what am I earning, and from what? | SKU / category / customer profitability with gross sales → discounts → returns → net sales → COGS → gross profit waterfall | Re-price, cap discounts, drop SKUs, renegotiate with low-margin buyers |
| **Inventory:** what to reorder, discount, discontinue? | Stock ageing, slow/non-moving value, turnover, reorder points, stockout history | Purchase order quantities, clearance, discontinue |
| **Working capital:** where is cash trapped? | AR/AP ageing, DSO/DIO/DPO/CCC, cash-release scenarios | Chase collections, tighten credit terms, cut stock |
| **Customer behaviour:** who will return or lapse? | RFM segments, repeat-purchase probability, lapsing-customer list | Who to call this week; who gets a reminder |
| **Growth:** how to use the data for campaigns? | Evidence-backed audience builder, campaign drafts (local LLM), approval, holdout measurement | Run a targeted campaign and know whether it worked |

## 4. Primary workflows

1. **Connect & import.** Choose a source (CSV/Excel template, Tally XML export, BUSY Excel export, or the storefront). Upload or sync, preview, review validation issues and commit. Reconcile totals against source control totals.
2. **Morning review (home).** See KPIs vs the previous period, open findings ranked by ₹ impact, data-freshness and data-quality banners.
3. **Investigate.** Drill from a finding to SKU, customer or supplier, down to the underlying vouchers.
4. **Act on a finding.** Accept, dismiss or snooze it. Accepting records a baseline and a measurement date; the system later reports realised vs expected.
5. **Ask.** Type a natural-language question. The LLM picks an approved tool and the answer shows the numbers, the tool used and the period.
6. **Campaign.** Pick a segment or finding-derived audience, generate a draft, edit it, approve audience + content + offer, send a test, then send through a configured channel. A holdout group is reserved and the outcome is measured after N days.

## 5. MVP (first shippable increment)

The MVP is the smallest product an owner could use weekly:

* Single tenant in the UI, with a tenant-scoped schema from day one.
* Synthetic demo tenant (clearly labelled) and a CSV/Excel import template.
* Import pipeline: staging → validation → idempotent commit → reconciliation report.
* Product profitability, stock ageing / slow-moving value, AR ageing + DSO.
* Rule-based findings (5 rules) with evidence, ₹ impact and assumptions.
* KPI dictionary page linked from every metric.

**Explicitly after MVP:** ML models, LLM, campaigns, Tally live sync, BUSY. Each is planned in `05-roadmap.md`.

## 6. Non-goals

* **Not an accounting system.** No posting back to Tally/BUSY, no GST return filing, no journal entries. Tally remains the book of record; we are a read-only analytical copy.
* No autonomous outreach, auto-discounting or auto-purchase orders. Every external action needs human approval.
* No real-time sync in the MVP (scheduled or manual imports only).
* No operating-profit claims unless expense ledgers are imported and mapped; until then, gross profit only.
* No multi-currency, no payroll, no mobile app.
* No unofficial or personal-WhatsApp automation.

## 7. Product principles

1. **Every number is traceable.** Metric → formula (KPI dictionary) → query → vouchers → source record → import batch.
2. **Missing beats wrong.** If cost, opening stock or due dates are missing, show "not available" plus the data needed, never a fabricated value.
3. **Three kinds of output, visibly separated:** *Measured* (deterministic, from ledger), *Predicted* (model output with uncertainty and version) and *Suggested* (rule- or LLM-generated actions with assumptions).
4. **Demo data is always labelled.** A persistent banner and a `isDemo` flag on the data source; demo and real data never mix in one tenant.
5. **Estimated impact ≠ realised impact.** These are tracked separately, and realised impact is only reported after measurement.

## 8. Success measures

* **Product:** an owner completes import → first finding → accepted action in under 15 minutes with the template.
* **Data:** 100 % of imported batches reconcile to source control totals within ₹1 (rounding), or show the discrepancy explicitly.
* **Decision:** percentage of findings reviewed, percentage accepted, and realised ₹ impact at follow-up (see `04-kpi-dictionary.md` §Platform KPIs).
