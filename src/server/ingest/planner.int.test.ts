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
  await prisma.$executeRawUnsafe(`ALTER TABLE "Voucher" SET (autovacuum_enabled = false)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SourceRecord" SET (autovacuum_enabled = false)`);
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

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "tiny" } } });
  if (tenantId) await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$executeRawUnsafe(`ALTER TABLE "Voucher" RESET (autovacuum_enabled)`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "SourceRecord" RESET (autovacuum_enabled)`);
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
