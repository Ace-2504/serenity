import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

/**
 * Regression test for a planner trap. When table statistics describe many tenants with a few
 * rows each (the state other test files, or a busy multi-tenant database, leave behind),
 * Postgres planned each (id, tenantId) foreign-key check on VoucherLine through the
 * (tenantId, type, date) index, scanning all of the tenant's vouchers per line: a 30 s commit
 * took 330 s. The pipeline now analyses each table right after loading it.
 */

const TINY = 400;
let tenantId: string | undefined;

async function seedTinyTenantStatistics() {
  await setAutovacuum(false);
  const g = `generate_series(1, ${TINY}) g`;
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`INSERT INTO "Tenant" (id, name, "domainPack", "isDemo", "createdAt", "updatedAt") SELECT 'tiny' || g, 'tiny', 'stationery', true, now(), now() FROM ${g}`),
    prisma.$executeRawUnsafe(`INSERT INTO "DataSource" (id, "tenantId", kind, name) SELECT 'tiny-ds' || g, 'tiny' || g, 'demo', 'x' FROM ${g}`),
    prisma.$executeRawUnsafe(`INSERT INTO "ImportBatch" (id, "tenantId", "dataSourceId") SELECT 'tiny-ib' || g, 'tiny' || g, 'tiny-ds' || g FROM ${g}`),
    prisma.$executeRawUnsafe(
      `INSERT INTO "SourceRecord" (id, "tenantId", "dataSourceId", "importBatchId", entity, "sourceKey", version, "contentHash", payload) SELECT 'tiny-sr' || g, 'tiny' || g, 'tiny-ds' || g, 'tiny-ib' || g, 'voucher', 'k', 1, 'h', '{}' FROM ${g}`
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO "Voucher" (id, "tenantId", "dataSourceId", "sourceKey", "sourceRecordId", type, number, date, "grossAmount", "taxableAmount", "totalInclTax", "updatedAt") SELECT 'tiny-v' || g, 'tiny' || g, 'tiny-ds' || g, 'k', 'tiny-sr' || g, 'sales_invoice', '1', '2025-01-01', 1, 1, 1, now() FROM ${g}`
    )
  ]);
  await prisma.$executeRawUnsafe(`ANALYZE "Voucher", "SourceRecord"`);
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "tiny" } } });
}

/** Table-level DDL waits for every open transaction on the table; bound the wait and say who held it. */
async function setAutovacuum(enabled: boolean) {
  for (const table of ["Voucher", "SourceRecord"]) {
    const sql = enabled ? `ALTER TABLE "${table}" RESET (autovacuum_enabled)` : `ALTER TABLE "${table}" SET (autovacuum_enabled = false)`;
    try {
      await prisma.$transaction([prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '20s'`), prisma.$executeRawUnsafe(sql)]);
    } catch (error) {
      const holders = await prisma.$queryRawUnsafe(
        `SELECT pid, state, now() - xact_start AS open_for, left(query, 120) AS query FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL`
      );
      throw new Error(`${sql} could not take its lock: ${(error as Error).message}; open transactions: ${JSON.stringify(holders)}`);
    }
  }
}

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "tiny" } } });
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await setAutovacuum(true);
  await prisma.$disconnect();
});

describe("import performance does not depend on stale planner statistics", () => {
  it("commits two years of data quickly after statistics describe many tiny tenants", async () => {
    await seedTinyTenantStatistics();
    const profile = scaledProfile(stationeryDemoProfile, { end: stationeryDemoProfile.end, maxItemsPerGroup: 5, maxPartiesPerSegment: 8 });
    const tenant = await prisma.tenant.create({ data: { name: "Planner test", domainPack: "stationery", isDemo: true } });
    tenantId = tenant.id;
    const db = forTenant(tenant.id);
    const source = await db.dataSource.create({ data: { tenantId: tenant.id, kind: "demo", name: "Demo" } });
    const staged = await stageImport(db, { tenantId: tenant.id, dataSourceId: source.id, files: datasetToFiles(generateDemoDataset(profile, 42)) });
    const started = Date.now();
    await commitImport(db, tenant.id, staged.batchId);
    // About 30 s on a laptop-class machine; the bad plan took over 300 s.
    expect(Date.now() - started).toBeLessThan(100_000);
  }, 300_000);
});
