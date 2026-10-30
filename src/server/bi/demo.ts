import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import type { DemoProfile } from "@/server/demo/profile";
import { pharmacyDemoProfile } from "@/server/demo/profiles/pharmacy";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { inHoldout } from "@/server/campaigns/tokens";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

export type DemoSize = "quick" | "full";
export const DEMO_PACKS = ["stationery", "pharmacy"] as const;
export type DemoPack = (typeof DEMO_PACKS)[number];

const quickPharmacy = scaledProfile(pharmacyDemoProfile, { end: "2025-03-31", maxItemsPerGroup: 10, maxPartiesPerSegment: 40 });
const PROFILES: Record<DemoPack, Record<DemoSize, DemoProfile>> = {
  stationery: {
    quick: scaledProfile(stationeryDemoProfile, { end: "2025-03-31", maxItemsPerGroup: 10, maxPartiesPerSegment: 30 }),
    full: stationeryDemoProfile
  },
  pharmacy: {
    // Six months: the expiry plants move earlier so they show within the shorter period.
    quick: {
      ...quickPharmacy,
      plant: {
        ...quickPharmacy.plant,
        shortDated: { ...quickPharmacy.plant.shortDated!, buyOn: "2025-01-05", lifeLeftDays: [90, 150] },
        expiredOpening: { ...quickPharmacy.plant.expiredOpening!, lifeLeftDays: [60, 110] }
      }
    },
    full: pharmacyDemoProfile
  }
};

/**
 * The two-year demo takes minutes to load. Serverless hosting (VERCEL=1) stops background work
 * after the request's time limit, so there it is offered only when a separate worker runs jobs.
 */
export const fullDemoAllowed = () => process.env.VERCEL !== "1" || process.env.JOBS_MODE === "worker";

export const demoProfile = (pack: DemoPack, size: DemoSize) => PROFILES[pack][size];

/**
 * Creates (or replaces) the user's demo business. Demo businesses are flagged isDemo and are
 * never mixed with real data; the data itself is loaded by loadDemoData, normally as a job.
 */
export async function createDemoTenant(userId: string, size: DemoSize, pack: DemoPack = "stationery") {
  const profile = PROFILES[pack][size];
  // One demo business per trade: loading it again replaces the previous one.
  const previous = await prisma.membership.findMany({ where: { userId, role: "owner_admin", tenant: { isDemo: true, domainPack: pack } }, select: { tenantId: true } });
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
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { domainPack: true } });
  const pack = (DEMO_PACKS as readonly string[]).includes(tenant.domainPack) ? (tenant.domainPack as DemoPack) : "stationery";
  const source = await db.dataSource.create({ data: { tenantId, kind: "demo", name: `Synthetic demo data (${size})`, isDemo: true } });
  const files = datasetToFiles(generateDemoDataset(PROFILES[pack][size], 42));
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
export async function createDemoBusiness(userId: string, size: DemoSize, pack: DemoPack = "stationery") {
  const tenant = await createDemoTenant(userId, size, pack);
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
