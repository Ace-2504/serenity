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
