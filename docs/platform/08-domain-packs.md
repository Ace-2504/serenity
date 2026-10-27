# 08 — Domain Packs: one core, many trades

Goal: build once for stationery, then add pharmacy (and later electrical, FMCG, hardware) **by adding a pack, not by forking the code**.

## 1. What is core and what is a pack

| Layer | Core (same for every trade) | Domain pack (per trade) |
|---|---|---|
| Ledger | Party, Item, Batch, Voucher, VoucherLine, StockMovement, snapshots, lineage | Extra **item attributes** (Zod schema), e.g. pharmacy `composition`, `schedule`, `packSize` |
| Ingestion | Adapters, staging, validation, idempotent commit, reconciliation | **Template columns** for the extra attributes; header synonyms (e.g. "Exp. Dt", "Batch No") |
| Metrics | All KPIs in `04-kpi-dictionary.md` | Extra KPIs, e.g. `near_expiry_value`, `expired_writeoff` |
| Findings | Rule engine, evidence/impact/measure-plan contract | Extra rules + **thresholds** (slow-mover days differ: 90 for stationery, 60 for pharmacy) |
| ML | Feature pipeline, repeat-purchase, forecasting, basket | **Seasonality calendar** (back-to-school vs monsoon/flu season); refill-interval features for chronic medicines |
| Assistant | Tool registry, numeric guard | **Glossary** and example questions in the trade's vocabulary |
| Campaigns | Approval, consent, holdout, channels | **Campaign policy**: which items may be promoted, which message types are allowed |
| Demo data | Generator engine | **Generator profile**: catalogue, customer types, seasonality, planted problems |

A pack is a typed TypeScript module (`src/domain/packs/<id>.ts`) implementing `DomainPack`. The tenant stores its `domainPack` id. Adding a trade means writing one module, one generator profile and its fixtures, then passing the shared test suite plus the pack's own tests.

## 2. Why stationery first, pharmacy second

* **Stationery has working code and lower regulatory risk.** It lets us prove the core (ledger, costing, findings, ML, assistant, campaigns) without health-data and drug-promotion constraints.
* **Pharmacy is the ideal second domain**, because it forces the core to generalise:
  * **Batch + expiry** inventory. Expired stock is hard dead stock with a date on it; FEFO (first-expiry-first-out) instead of FIFO ageing.
  * **MRP-inclusive pricing.** Retail prices include GST, and selling above the printed MRP is not allowed, so the template must back GST out of inclusive prices.
  * **Repeat purchase is clinically regular** (chronic-medicine refills). That is the strongest real-world case for repeat-purchase prediction.
  * **Stricter campaign rules** prove the policy layer is real, not decorative.
* So the core gets **batch/expiry fields from M1** (optional, unused by stationery). Pharmacy then becomes a pack, not a migration.

## 3. Pharmacy pack — known constraints (to verify with a domain/legal review before launch)

| Area | Constraint | Product consequence |
|---|---|---|
| Drug schedules | Drugs and Cosmetics Rules: Schedule H/H1/X medicines need a prescription for retail sale; H1 sales need a separate register | `schedule` attribute; scheduled items **excluded from all promotional campaigns** by pack policy |
| Advertising | Indian law restricts advertising medicines to the public (Drugs and Magic Remedies Act, D&C Rules) | Promotions limited to OTC/wellness/devices. Refill reminders are informational service messages with **no offers**, sent only with explicit consent |
| Pricing | MRP is printed and tax-inclusive; price controls apply to some formulations | Import flag `priceIncludesTax`; finding rules never suggest prices above MRP |
| Health data | Purchase history implies health conditions; DPDP Act 2023 consent and purpose limits apply | Customer-level pharmacy data treated as high-sensitivity: never sent to a remote LLM, masked in logs, refill features kept in-tenant |
| Source software | Many Indian chemists and pharma distributors use pharmacy-specific ERPs (e.g. Marg) rather than Tally/BUSY | Integration route for those systems is **unresearched**; file import via template is the starting point |

## 4. Definition of "replicable" (tested, not claimed)

A new pack is accepted when:
1. The generic test suite (formulas, idempotency, tenant isolation, reconciliation) passes on the pack's generated dataset **without core code changes**.
2. The pack's own fixture tests pass (its extra KPIs and rules).
3. The demo flow (import → finding → action) runs end-to-end for that pack.

## 5. Automatic · deterministic · AI — where each lives

| Property | Where | Example |
|---|---|---|
| **Automatic** | Jobs after each import: rebuild stock ledger → refresh views → run rules → score models → queue follow-ups | New import at night → findings ready in the morning |
| **Deterministic** | Ingestion, ledger, metrics, rules. Same input → same output, unit-tested | Net sales, COGS, DSO, `SLOW_MOVER_CAPITAL` |
| **AI (probabilistic, labelled)** | ML predictions; LLM column-mapping suggestions at import; LLM explanations and campaign drafts | "Map column `Exp Dt` → `batch.expiryDate`?" (owner confirms, mapping saved as a deterministic rule) |

AI suggests and explains; deterministic code computes and decides what is shown as fact. Every AI output is confirmed by a human or verified against deterministic results before it affects data or reaches a customer.
