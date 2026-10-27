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
