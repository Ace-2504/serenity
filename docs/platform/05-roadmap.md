# 05 — Implementation Roadmap

Each milestone ends with the app running, `npm test` / `tsc` / `lint` green, and docs updated. Milestones are vertical where possible: data → metric → UI → test.

## Order and why it differs from the brief

The brief's phases are kept, with two changes:

1. **The Tally adapter (brief Phase 6) is split.** A *file-based* Tally XML parser built on fixtures moves up to **M4**, right after the CSV pipeline proves the staging/commit/reconcile machinery. *Live* HTTP sync stays late (M10), because it needs a real Tally instance to verify. Tally is the product's reason to exist, so the riskiest mapping (vouchers → canonical) should be exercised early, even against fixtures.
2. **Basic customer analytics (RFM) moves into Phase 3 (M6).** RFM is deterministic arithmetic, not ML. It is also the baseline every Phase 4 model must beat.

## Milestones

| # | Milestone | Depends on | Acceptance criteria |
|---|---|---|---|
| **M0** | Audit, spec, architecture, model, KPI dictionary, roadmap, risks (this folder) | — | Docs reviewed by owner; candidate choice confirmed |
| **M1** | **Foundation**: `Tenant`/`Membership`, canonical ledger tables (incl. optional `Batch`) + migration, `DomainPack` interface with stationery + pharmacy stubs, `forTenant` data-access helper, auth debt fixes 1–3, Zod, metric registry skeleton | M0 | Migration applies on a fresh DB and on a DB with existing storefront data; two-tenant isolation test passes; session expiry test passes |
| **M2** | **Synthetic data generator** (fictional distributor, 2 FY, ~250 SKUs, ~400 customers, ~60 suppliers, seasonality, credit terms, returns, discounts, slow movers, two lapsing key accounts) | M1 | Generator is deterministic for a seed; invariants (stock ≥ 0, receipts ≤ invoices, returns reference real sales, ledger balances) are asserted by tests; dataset labelled DEMO |
| **M3** | **CSV/Excel import pipeline**: template (`.xlsx` + CSV), staging, validation report, idempotent commit, file-hash dedup, corrections (versioning), reconciliation vs control totals, import UI with preview | M1, M2 (generator also emits the template format) | Re-import is a no-op; corrupt rows produce row-level issues and block commit; interrupted commit leaves no partial data; control totals reconcile within ₹1 |
| **M4** | **Tally XML file adapter** (exported Day Book / vouchers / masters / stock summary / bills outstanding) on documented-format fixtures | M3 | Fixture vouchers map to canonical; Tally GUID/AlterID kept as source keys; malformed XML (bad entities, truncation) produces issues, not crashes. Labelled "verified on fixtures only" |
| **M5** | **Profitability & inventory analytics**: stock ledger (WAC), product profitability table + drill-down, waterfall, stock ageing, slow-moving value, turnover/DIO with status semantics, KPI dictionary page | M3 | Every formula has a hand-computed unit test; turnover is `unavailable` without cost data; drill-down totals = table totals |
| **M6** | **Customers & working capital**: order metrics, RFM, concentration, AR/AP ageing, DSO/DPO/CCC, cash-release scenarios | M5 | AR ageing reconciles to the outstanding snapshot; scenario outputs are labelled as estimates |
| **M7** | **Findings engine + home screen**: 7 rules, evidence, ₹ impact, accept/dismiss, measurement plan, follow-up job | M5, M6 | Each rule has positive and negative fixture tests; the demo dataset surfaces the planted problems (slow stock, lapsing accounts, margin erosion) |
| **M8** | **ML**: Python worker; repeat-purchase model vs RFM and recency baselines with a time-based backtest; intermittent-demand forecast (Croston/SBA, ETS) vs seasonal-naive; basket lift; model registry, predictions UI with factors | M6 | Leakage test: features use only data ≤ cutoff; model reported **only if** it beats the baseline on held-out windows. Otherwise the baseline ships and the report says so |
| **M9** | **Local LLM assistant + campaigns**: tool registry, numeric guard, assistant logs; campaign drafts, approval state machine, consent, holdout, `outbox` channel; SMTP adapter | M7, M8 | Guard test suite (answers with altered numbers are rejected); sends impossible without owner approval and consent; holdout excluded from sends |
| **M10a** | **Marketplace & quick-commerce file adapters**: Amazon Settlement V2 flat file, Meesho payments + GST (TCS) exports, Blinkit/Zepto PO, GRN and debit-note files → canonical vouchers + ChannelCharge | M3, M5 | Fixture files parse into canonical rows; per-order contribution reproduces a hand-computed example; period-level TDS allocated and reconciled to the payout |
| **M10b** | **Live Tally sync** (HTTP XML on LAN, incremental via AlterID) + **BUSY Excel adapter**; Amazon SP-API (Finances v0, non-restricted roles only) | M4, M10a | Verified against a real TallyPrime instance (needs owner access), or stays labelled unverified |
| **M11** | **Hardening & demo**: RLS, rate limits, backups doc, Docker Compose (app + Postgres + worker + Ollama), observability page, scripted end-to-end demo, Playwright E2E | all | Fresh clone → `docker compose up` → demo flow works; E2E passes |
| **M12** ✅ | **Pharmacy domain pack**: batch/expiry ageing (FEFO), near-expiry findings, MRP-inclusive import, pharmacy generator profile, campaign policy excluding scheduled drugs | M11 | Generic suite passes on pharmacy data; pack-specific tests pass; legal/policy notes reviewed. **Built 2026-10-27:** generic checks and pack tests pass. Batch support went into the core as an optional, generic capability (see 08 §3.1). **Legal review not done**: it needs a qualified professional |

## The first vertical slice (proposed next work: M1 → M3 → part of M5)

> Import a CSV of a fictional distributor's vouchers → validate → commit idempotently → see a reconciled **product profitability** table with a gross-profit waterfall, slow-moving stock value, and one finding (`SLOW_MOVER_CAPITAL`) with evidence.

This one slice exercises tenancy, ingestion, lineage, WAC costing, status semantics, the KPI registry, a finding and the UI. Everything later is more of the same pattern.

### Slice acceptance tests

1. `generator(seed=42)` → CSV → import → `net_sales` equals the generator's own independently computed total.
2. Importing the same file twice → second batch reports `duplicate_file`, no row changes.
3. Edited invoice amount → new `SourceRecord` version, old one superseded, metrics change by exactly the delta.
4. Missing opening stock for an item → that item's GP is `partial`/`unknown`, not computed with zero cost.
5. Tenant B cannot read tenant A's data through any metric endpoint.
6. `SLOW_MOVER_CAPITAL` fires for planted slow movers and not for seasonal items within the threshold.
