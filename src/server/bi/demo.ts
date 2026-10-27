import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { inHoldout } from "@/server/campaigns/tokens";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

export type DemoSize = "quick" | "full";

const PROFILES = {
  quick: scaledProfile(stationeryDemoProfile, { end: "2025-03-31", maxItemsPerGroup: 10, maxPartiesPerSegment: 30 }),
  full: stationeryDemoProfile
};

/**
 * Creates (or replaces) the user's demo business. Demo businesses are flagged isDemo and are
 * never mixed with real data; the data itself is loaded by loadDemoData, normally as a job.
 */
export async function createDemoTenant(userId: string, size: DemoSize) {
  const profile = PROFILES[size];
  const previous = await prisma.membership.findMany({ where: { userId, role: "owner_admin", tenant: { isDemo: true } }, select: { tenantId: true } });
  if (previous.length > 0) {
    await prisma.tenant.deleteMany({ where: { id: { in: previous.map((m) => m.tenantId) }, isDemo: true } });
  }
  return prisma.tenant.create({
    data: { name: profile.company, domainPack: profile.packId, isDemo: true, memberships: { create: { userId, role: "owner_admin" } } }
  });
}

/** Loads the synthetic dataset through the same stage -> commit pipeline as a real upload. */
export async function loadDemoData(tenantId: string, size: DemoSize, userId?: string, onStep?: (step: string) => void) {
  const db = forTenant(tenantId);
  onStep?.("generate");
  const source = await db.dataSource.create({ data: { tenantId, kind: "demo", name: `Synthetic demo data (${size})`, isDemo: true } });
  const files = datasetToFiles(generateDemoDataset(PROFILES[size], 42));
  onStep?.("stage");
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files, userId });
  if (staged.status !== "validated") {
    throw new Error(`Demo data failed validation (${staged.summary.issues.errors} errors)`);
  }
  const committed = await commitImport(db, tenantId, staged.batchId, { userId, onStep });
  await seedDemoConsents(tenantId);
  return { batchId: staged.batchId, durationMs: committed.durationMs };
}

/** Synchronous create + load, for scripts and tests. */
export async function createDemoBusiness(userId: string, size: DemoSize) {
  const tenant = await createDemoTenant(userId, size);
  return { tenantId: tenant.id, ...(await loadDemoData(tenant.id, size, userId)) };
}

/**
 * The demo business is fictional, so are its customers' consents: 70% of customers with an email
 * address (example.com, which never delivers) get a consent record labelled as demo data.
 * Real businesses start with no consent and record it themselves.
 */
async function seedDemoConsents(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { isDemo: true } });
  if (!tenant.isDemo) return;
  const db = forTenant(tenantId);
  const parties = await db.party.findMany({ where: { email: { not: null }, anonymousBuyers: false }, select: { id: true } });
  const chosen = parties.filter((p) => inHoldout("demo-consent", p.id, 70));
  await db.contactConsent.createMany({ data: chosen.map((p) => ({ tenantId, partyId: p.id, channel: "email", status: "granted", source: "Demo data: fictional consent" })) });
}
