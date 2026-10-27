# Milestone Log

## M0 — Audit and plan (2026-10-27)
Planning docs 00–08 in this folder. No production code changed.

## M1 — Foundation (2026-10-27)

**Implemented**
* Canonical, tenant-scoped ledger: 16 tables + 9 enums (`Tenant`, `Membership`, `DataSource`, `ImportBatch`, `ImportIssue`, `SourceRecord`, `Party`, `ItemGroup`, `Item`, `Batch`, `Voucher`, `VoucherLine`, `StockMovement`, `StockSnapshot`, `OutstandingSnapshot`, `AuditLog`). Money `Decimal(18,2)`, quantities `Decimal(18,3)`. Batch/expiry fields included now, so the pharmacy pack (M12) needs no migration.
* **Cross-tenant links blocked by the database:** 19 composite `(id, tenantId)` foreign keys. Optional links use `Restrict`/`Cascade` (never `SetNull`, which would null `tenantId`).
* `forTenant(tenantId)`: a Prisma client extension that adds the tenant predicate to every read, update and delete, stamps `tenantId` on creates, and refuses writes addressed to another tenant.
* Session fixes (debt items 1–3): tokens expire after 7 days (matching the cookie), there is no fallback secret in production, and signatures are compared in constant time. Existing call sites are unchanged.
* `DomainPack` contract with an active `stationery` pack and a `planned` `pharmacy` pack (attribute schemas via Zod, thresholds, seasonality, campaign policy that blocks prescription-drug promotion, batch tracking, tax-inclusive pricing).
* Integration test harness against real PostgreSQL (`npm run test:int`, `TEST_DATABASE_URL`); CI runs it with a Postgres 16 service.

**Files**
* `prisma/schema.prisma` (storefront models untouched except a `memberships` back-relation on `User`)
* `prisma/migrations/20261027064801_canonical_ledger/`
* `src/lib/auth.ts`, `src/lib/auth.test.ts`
* `src/server/db/tenant.ts`, `tenant.test.ts`, `tenant.int.test.ts`
* `src/domain/types.ts`, `src/domain/packs/{index,stationery,pharmacy}.ts`, `packs.test.ts`
* `vitest.config.ts`, `vitest.integration.config.ts`, `scripts/test-db-setup.mjs`, `.github/workflows/ci.yml`, `package.json`, `.env.example`

**Why this design**
* Composite foreign keys make isolation a database guarantee, not just a convention. Even an unscoped query or a nested `include` cannot join across tenants.
* The extension is a single choke point that is easy to audit. A unit test fails if any model with a `tenantId` column is missing from the scoped list.
* Packs are plain typed modules, not database configuration: reviewable, testable, and versioned with the code.

**Tests (actual results, this container, PostgreSQL 16)**
```
npm run lint        0 errors, 1 pre-existing warning (admin/inventory <img>)
npx tsc --noEmit    no errors
npm test            4 files, 25 tests passed
npm run test:int    1 file, 9 tests passed
npm run build       compiled successfully
prisma migrate diff (migrations vs schema)   no difference
```
Migration is additive only: no `DROP`, and no `ALTER` on storefront tables.

**Known limitations**
* Raw SQL (`$queryRaw`) is not scoped by the extension. Analytics SQL must take `tenantId` explicitly; Postgres RLS is planned for M11.
* No UI or API uses the new tables yet; tenant selection in the session comes with the import UI (M3).
* The metric-registry skeleton planned for M1 has moved to M5, where the first metrics exist; an empty registry would be speculative.
* Pharmacy regulatory rules are encoded from general knowledge and need legal review (see `08-domain-packs.md`).

**Next: M2 — synthetic data generator** (seeded, deterministic, stationery profile, planted problems, accounting invariants asserted by tests).

## M2 — Synthetic data generator (2026-10-27)

**Implemented**
* Deterministic generator (`src/server/demo/`): seeded PRNG with independent sub-streams; a trade-agnostic engine; a stationery profile for the fictional *Kalamkaar Distributors (DEMO)*. 2 years (Oct 2024–Sep 2026), 245 items, 1,229 parties, ~41k sales invoices across **6 channels**: direct B2B, counter, own website, Amazon, Meesho, Blinkit.
* Output is the **import template** (`src/server/ingest/template.ts`): items, parties, vouchers (day-book lines), settlements (bill-wise), stock summary, bills outstanding, channel charges, control totals. Plus `ground_truth.json` with planted problems and the totals analytics must reproduce. Demo data will enter the database through the same importer as real data (M3).
* Accounting rules: integer paise; weighted-average cost; demand capped by stock (lost demand recorded); credit notes reduce their invoice; receipts/payments allocated bill-wise; marketplace payouts net of fees with TCS per order and TDS per settlement period.
* Planted problems:
  * 8 bulk-bought slow movers (₹11.3 L stuck at period end);
  * 2 lapsing key retailers;
  * 8 schools that didn't reorder for the new school year;
  * a 14% cost rise plus extra discounting on Pens (margin erosion);
  * 25 slow payers (+30–75 days);
  * 2 chronic stockout SKUs;
  * 3 items with missing opening cost;
  * emergent marketplace loss-makers (Meesho: 48% gross margin → 1.3% contribution after shipping).
* `npm run demo:generate -- --seed 42 --out <dir>` writes the files (~4 s, ~21 MB). Output is git-ignored because it is reproducible.

**Why this design**
* Generating *template files* rather than writing to the database means the demo exercises the real ingestion path. It also gives users a worked example of the template.
* The tests are black-box: they parse the emitted rows and independently rebuild stock, WAC valuation, bills and contribution, then check the generator's ground truth against that rebuild. This caught a real bug during development: two product groups produced the same item codes (`PEN-001` for both Pens and Pencils). The engine now refuses duplicate codes.

**Tests (actual results, this container)**
```
npm test            5 files, 51 tests passed   (generator suite: 26 tests, ~24 s)
npm run test:int    1 file, 9 tests passed
npm run lint / tsc / build   clean (1 pre-existing lint warning)
```
Covered:
* determinism (same seed → identical hash);
* no realistic contact data;
* referential integrity and posting order;
* line arithmetic on every row;
* stock never negative and equal to the stock summary;
* independent WAC replay equal to the reported closing value;
* returns within quantities sold;
* bills never over-settled and outstanding exact;
* control totals;
* channel-charge integrity;
* ground truth = independent rebuild (FY net sales/COGS, contribution per channel × item);
* each planted problem visible in the data.

**Known limitations**
* Fee amounts, GST rates per group, HSN codes, payout timings, return rates and Blinkit's buy price/terms are **illustrative**, labelled as such in the profile and dataset notice.
* Simplifications: single warehouse (no FBA stock); no B2C refunds on the own website or counter; no Blinkit fill-rate debit notes; Amazon referral fee omitted (0% under ₹1,000 for stationery).
* The generator suite takes ~24 s (three full generations plus row-level checks). Acceptable for now; it can share one generated dataset across files later.

**Next: M3 — import pipeline** (template parsing with Zod, staging, validation report, idempotent commit, file-hash dedup, corrections, reconciliation to control totals, `ChannelCharge` table).

## M3 — Import pipeline (2026-10-27)

![Import review screen: change preview and reconciliation for the full demo](screenshots/import-review.png)

**Implemented**
* **Parser** (`src/server/ingest/parse.ts`): CSV via `csv-parse`.
  * Handles BOM, CRLF, quoted commas and the formula guard.
  * Amounts and quantities become exact decimals.
  * Every problem becomes an issue with `file:line` and field; the parser never throws on bad data.
  * Limits: 50 MB per file, 1 M rows per file.
* **Validation** (`validate.ts`):
  * line arithmetic to the paisa;
  * tax within ₹1 (warning) or rejected;
  * consistent voucher headers;
  * unique codes;
  * party roles;
  * references to earlier imports;
  * returns (party, date, quantity);
  * settlements (unknown bill, over-settled);
  * channel-charge orders;
  * domain-pack item attributes;
  * vouchers inside the stated period;
  * **control-total reconciliation**.
* **Staging** (`pipeline.ts`): stores the exact bytes (`ImportFile`) and a preview of new / changed / unchanged / removed-at-source records per entity, plus all issues.
* **Commit**:
  * Re-verifies the stored files by SHA-256, re-validates against the current database, and writes in one transaction.
  * **Reconciles the database against the control totals inside that transaction**, so a mismatch rolls everything back; "committed" always means "reconciled".
  * A per-data-source advisory lock serialises concurrent imports.
* **Idempotency and corrections**:
  * Re-uploading the latest committed bytes is a no-op.
  * Changed records get a new `SourceRecord` version and the old one is superseded; ids stay stable, so links survive.
  * Full-period semantics mark missing records `deleted_at_source` and restore them if they come back.
* **Schema**: `ChannelCharge`, `BillAllocation`, `ImportFile`, snapshot lineage, `Voucher.orderRef`, `Party.anonymousBuyers` (a rename, not drop+add). Indexes behind every platform foreign key.
* **App**:
  * `/bi/imports`: onboarding (demo or create business), upload, history, data-source freshness.
  * `/bi/imports/[id]`: change preview, reconciliation, issues with row references, commit.
  * `/bi/template`: column documentation and downloadable examples.
  * APIs under `/api/bi/*` with Zod input validation and membership roles (`owner_admin` / `accountant` can import; `analyst` can view).
* **Demo**:
  * Quick (6 months) and full (2 years) demo businesses go through the same stage → commit path.
  * Demo businesses are flagged, show a persistent banner, and **refuse uploads**, so demo and real data never mix.
* Zepto and Swiggy Instamart added to the demo as quick-commerce buyers.

**Performance (this container, PostgreSQL 16)**

| Dataset | Stage | Commit | Re-upload same files |
|---|---|---|---|
| Quick demo (6 months, ~10k voucher rows) | ~1 s | ~5 s | — |
| Full demo (2 years, 144k voucher lines, 80k vouchers, 108k source records) | 15 s | 75–83 s | 6 s (no-op) |

Three problems were found and fixed by measuring rather than guessing:
* **Missing foreign-key indexes** made cascading deletes quadratic: tenant delete took over 10 minutes, now 11 s.
* **Prisma `createMany`** was the commit bottleneck (155 s). Large tables now use a `jsonb_to_recordset` bulk insert that enforces `tenantId` on every row.
* **Stale planner statistics** inside the commit transaction gave nested-loop plans (reconciliation 5.8 s → 18 ms after `ANALYZE`). The commit now ANALYZEs the tables it loaded, and reconciliation uses explicit joins.

**Tests (actual results)**
```
npm test            7 files, 81 tests passed
npm run test:int    3 files, 27 tests passed (~34 s)
npm run lint / tsc / build   clean (1 pre-existing lint warning)
```
* Parser/validator (30): the full demo bundle has 0 errors and an exact match on all 8 control totals; one test per failure mode; template docs and examples stay consistent.
* Pipeline against Postgres (12):
  * stage preview; commit and reconcile;
  * returns and charges linked;
  * duplicate upload is a no-op;
  * a corrected invoice becomes version 2 with the same id;
  * deleted-at-source and restore;
  * an interrupted commit leaves nothing behind and can be retried;
  * errors block commit;
  * bad domain attributes rejected;
  * **two concurrent commits → exactly one succeeds**;
  * cross-tenant access refused;
  * every platform foreign key has an index.
* API (6): 401 / 404 / 403 role rules, demo upload refused (409), owner stage → commit, cross-business 404.
* Browser walkthrough (Playwright, production build):
  * sign in → onboarding → quick demo (12.6 s) → 8/8 totals match;
  * create a real business → broken upload rejected with 3 row-level errors;
  * full demo through the UI in 114 s;
  * no horizontal scroll at 390 px on BI pages.

**Bugs the tests caught in my own code (all fixed)**
* The concurrent-commit test found the batch status was read before taking the lock, so two commits could both report success.
* The browser walkthrough found that uploads were accepted into demo businesses.
* At phone width, a grid column stretched to the table's minimum width.

**Known limitations**
* Imports run inside the web request (fine self-hosted; the full demo needs the 300 s route limit). A background job queue comes with M7.
* Excel (.xlsx) upload is not supported yet: CSV only. The template page says so implicitly by asking for CSV.
* Only the template adapter exists. Tally XML (M4) and marketplace settlement files (M10a) will reuse this pipeline.
* Storefront debt left as found:
  * 10 storefront foreign keys without indexes;
  * the storefront home page overflows by 83 px at 390 px width.
  * I fixed only the shared top-nav wrapping, which affected every page.

**Next: M4 — Tally XML file adapter**, or **M5 — profitability & inventory analytics** if a visible dashboard matters more right now.

## M5 — Profit & stock analytics (2026-10-27)

![Profitability dashboard](screenshots/profitability.png)
![Inventory dashboard](screenshots/inventory.png)

**Implemented**
* **Stock ledger** (`src/server/ledger/stock.ts`), rebuilt inside every import commit, so analytics never see half an import:
  * Weighted-average cost in the source's posting order (`Voucher.postingSeq`, excluded from the change hash).
  * Returns come back at the original line's cost; purchase returns leave at invoice value.
  * Unknown opening value means unknown cost until the stock is used up.
  * Negative stock (Tally allows it) is costed at the last known unit cost and counted.
  * Writes `StockMovement` and each sales line's cost through bulk SQL.
* **Stock check:** after rebuilding, the ledger is compared with the source's closing stock, item by item, and the result is stored on the import. On the demo it matches exactly.
* **Analytics** (`src/server/analytics/`):
  * profitability by product / channel / channel × product / group / month: gross sales → discounts → returns → net sales → COGS → gross profit → channel charges → contribution, with cost coverage;
  * stock positions, inventory value, average inventory over month-end points, turnover and days of inventory (cost-based; `partial` / `unavailable` states);
  * FIFO-layer stock ageing;
  * slow / non-moving stock from domain-pack thresholds;
  * stockout days.
* **Screens**:
  * `/bi/profitability`: filters, KPI tiles with "how?" links, profit bridge, channel dumbbell, monthly trends, sortable product table.
  * `/bi/inventory`: tiles, ageing, value by group, slow / non-moving items, stockouts.
  * `/bi/products/[id]`: drill-down to the source transactions.
  * `/bi/metrics`: definitions from the metric registry, which a test keeps in sync with the KPI dictionary.
* **Charts:**
  * The palette was validated with the dataviz checker; the brand green failed the chroma floor, so charts use the validated reference blue/orange.
  * Hover and keyboard tooltips, legends for 2+ series, a table view for the bridge, and no dual axes.

**Tests (actual results)**
```
npm test            9 files, 87 tests passed
npm run test:int    4 files, 38 tests passed (~77 s)
lint / tsc / build  clean (1 pre-existing lint warning)
```
* Against the generator's ground truth, on a two-year demo with every channel and planted problem:
  * net sales, COGS and channel charges match exactly for every channel × product (checked both ways);
  * net sales, COGS, returns and discounts match for every financial year;
  * the ledger equals the source closing stock for every item.
* Also tested: partial cost coverage reported instead of zero cost; every unit on hand aged exactly once; planted slow movers and stockouts detected; turnover formula checked and `unavailable` without sales; Indian financial-year periods.
* Browser (production build, full two-year demo):
  * pages render in 0.3–2.8 s;
  * the product drill-down works and tooltips show on hover;
  * no horizontal scroll at 390 px.

**Bugs found and fixed**
* Passing formatter functions from server pages into client charts crashed the page (React Server Components forbid it). Charts now take a format name.
* The business switcher and a dumbbell label overflowed on phones.

**Known limitations**
* Reloading the full demo through the UI took 277 s in one run (deleting the previous demo plus generating, staging and committing), close to the 300 s route limit. The background job queue in M7 removes this.
* The ledger is rebuilt for the whole business on each import (≈10 s for the full demo); incremental rebuilds can come later.
* Analytics combine all of a business's data sources. Two sources reporting the same sale (e.g. storefront and Tally) would double count, so source de-duplication is needed before mixing sources.
* The app has no dark mode; charts are validated for its light surface only.

## M6 — Customers & working capital (2026-10-27)

![Customers](screenshots/customers.png)
![Cash](screenshots/cash.png)

**Implemented**
* **Order and customer metrics** (`src/server/analytics/customers.ts`):
  * invoices, average and median order value, units per order, orders per customer, repeat purchase rate, discounted-order share;
  * customer metrics over named buyers only (counter and marketplaces excluded).
* **RFM segments** (Champions, Loyal, New, Steady, Lapsing, At risk, Inactive), with a rhythm- and season-aware **lapsing** rule:
  * the customer has 3+ orders and lifetime value in the top 60%;
  * the silence is longer than max(30 days, 2 × usual gap);
  * at least 1.5 orders would normally have been placed since the silence became unusual, judged from the customer's own purchases by calendar month.
* **Buyer concentration:** top 5 / top 10 share and HHI; a marketplace counts as one buyer.
* **Working capital** (`working-capital.ts`):
  * receivables and payables rebuilt as on any date from bills, credit/debit notes and allocations;
  * ageing by due date;
  * DSO and DPO from month-end averages over credit volume; DIO from the stock ledger; cash conversion cycle with partial/unavailable states;
  * trade working capital;
  * scenarios: faster collection, and clearing slow stock at an owner-set recovery rate (labelled as estimates).
* **Pages:**
  * `/bi/customers`: tiles, segments, biggest buyers, segment lists ranked by lifetime value.
  * `/bi/customers/[id]`: segment, rhythm, monthly purchases, open bills.
  * `/bi/cash`: balances, cash cycle, AR/AP ageing, who to call first, scenario calculator.

**How the lapsing rule was arrived at (measured on the full demo)**

| Rule | Lapsing customers | Problem |
|---|---|---|
| Silence > 2 × median gap | 120+ | Every school flagged each off-season |
| … and > longest previous gap, 3+ orders | 120+ | Small web buyers flagged by chance; a school with off-season orders still flagged |
| Expected orders in the silent window (by calendar month) ≥ 1.5, top 60% value | 100+ | Peak-month tail (a school stopping mid-June) still inflated expectations |
| **… counted only after the silence became unusual** | **40** | Planted key accounts at the top, plus planted schools that skipped a season; schools in their normal off-season are no longer flagged |

**Tests (actual results)**
```
npm test            10 files, 92 tests passed
npm run test:int    4 files, 45 tests passed
lint / tsc / build  clean (1 pre-existing lint warning)
```
* Every open receivable and payable bill equals the source's bills-outstanding report to the paisa.
* Ageing sums to the total; DSO follows its formula on 13 month-end points.
* Order metrics match the generator.
* The lapsing rule flags all planted lapsing accounts and every school that skipped a season, but no school active in the last 200 days and no customer below the 40th value percentile.
* Concentration is consistent (top 10 ≥ top 5; the shares sum).
* Unit tests cover ageing buckets, the days formula, the cash cycle's partial/unavailable states, and scenario clamps.
* Browser: pages render in 1–4 s with no horizontal scroll at 390 px.

**Known limitations**
* Unallocated (on-account) receipts are not netted against receivables; template data always allocates receipts to bills.
* The cash page takes about 4 s on the full demo: receivables are rebuilt for 13 month-end dates. Caching or snapshot tables can come with M7 jobs.
* RFM thresholds are relative (quintiles), so segment sizes depend on the customer mix.
