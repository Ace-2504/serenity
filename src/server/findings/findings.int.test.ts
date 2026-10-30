import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import { scaledProfile } from "@/server/demo/profiles/scale";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { fillRate } from "@/server/analytics/channels";
import { shift } from "@/server/findings/context";
import { actOnFinding, FindingActionError, generateDrafts, measureOutcomes, refreshFindings, trackRecord, type MeasurePlan } from "@/server/findings/engine";
import type { FindingDraft } from "@/server/findings/types";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

/** Two years, every channel and planted problem, few items and parties. */
const profile = scaledProfile(stationeryDemoProfile, { end: stationeryDemoProfile.end, maxItemsPerGroup: 5, maxPartiesPerSegment: 8 });
const EARLY = "2026-03-31";
const OWNER = "owner-user";

let data: DemoDataset;
let tenantId: string;
let db: ReturnType<typeof forTenant>;
let drafts: FindingDraft[];
const codeOfItem = new Map<string, string>();
const codeOfParty = new Map<string, string>();
const groupName = new Map<string, string>();

beforeAll(async () => {
  data = generateDemoDataset(profile, 42);
  const tenant = await prisma.tenant.create({ data: { name: "Findings test", domainPack: "stationery", isDemo: true } });
  tenantId = tenant.id;
  db = forTenant(tenantId);
  const source = await db.dataSource.create({ data: { tenantId, kind: "demo", name: "Demo" } });
  const staged = await stageImport(db, { tenantId, dataSourceId: source.id, files: datasetToFiles(data) });
  await commitImport(db, tenantId, staged.batchId);
  for (const i of await db.item.findMany({ select: { id: true, sourceKey: true } })) codeOfItem.set(i.id, i.sourceKey);
  for (const p of await db.party.findMany({ select: { id: true, sourceKey: true } })) codeOfParty.set(p.id, p.sourceKey);
  for (const g of await db.itemGroup.findMany({ select: { id: true, name: true } })) groupName.set(g.id, g.name);
  drafts = await generateDrafts(db, tenantId, data.meta.periodTo);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
  await prisma.$disconnect();
});

const byRule = (rule: string) => drafts.filter((d) => d.ruleId === rule);

describe("rules surface the planted problems, and only those", () => {
  it("slow movers: every finding is a planted slow mover", () => {
    const planted = new Set(data.groundTruth.planted.slowMovers.map((s) => s.itemCode));
    const found = byRule("SLOW_MOVER_CAPITAL").map((d) => codeOfItem.get(d.entityId!)!);
    expect(found.length).toBeGreaterThanOrEqual(planted.size - 2);
    expect(found.filter((c) => !planted.has(c))).toEqual([]);
  });

  it("margin erosion and discount rise: the planted group only", () => {
    const group = data.groundTruth.planted.marginErosion.group;
    expect(byRule("MARGIN_EROSION").map((d) => groupName.get(d.entityId!))).toEqual([group]);
    expect(byRule("DISCOUNT_LEAKAGE").filter((d) => groupName.get(d.entityId!) !== group)).toEqual([]);
  });

  it("collections: the customers listed are the planted slow payers", () => {
    const [finding] = byRule("COLLECTIONS_SLOWING");
    const planted = new Set(data.groundTruth.planted.slowPayers.map((s) => s.partyCode));
    const listed = (finding.measurePlan.subjects ?? []).map((id) => codeOfParty.get(id)!);
    expect(listed.filter((c) => !planted.has(c))).toEqual([]);
    expect(listed.length).toBeGreaterThanOrEqual(Math.ceil(planted.size * 0.8));
  });

  it("lapsing: both planted key customers are flagged", () => {
    const flagged = new Set(byRule("LAPSING_KEY_CUSTOMER").map((d) => codeOfParty.get(d.entityId!)));
    for (const c of data.groundTruth.planted.lapsingKeyCustomers) expect(flagged.has(c.partyCode), c.partyCode).toBe(true);
  });

  it("stockouts: exactly the planted items", () => {
    const found = byRule("STOCKOUT_REPEAT").map((d) => codeOfItem.get(d.entityId!)).sort();
    expect(found).toEqual(data.groundTruth.planted.stockoutItems.map((i) => i.itemCode).sort());
  });

  it("channel loss makers: marketplace listings that lose money after fees", () => {
    const rows = byRule("CHANNEL_LOSS_MAKER");
    expect(rows.length).toBeGreaterThan(0);
    for (const d of rows) {
      expect(["amazon", "meesho", "own_web"]).toContain(d.dedupeKey.split("|")[1]);
      expect(d.impactInr).toBeGreaterThan(0);
    }
  });

  it("low fill rate: only quick-commerce channels below target, with the shortfall the data shows", async () => {
    const window = { from: shift(data.meta.periodTo, -89), to: data.meta.periodTo };
    const actual = new Map((await fillRate(db, tenantId, window, "channel")).map((r) => [r.key, r]));
    for (const d of byRule("FILL_RATE_LOW")) {
      const channel = d.dedupeKey.split("|")[1];
      expect(["blinkit", "zepto", "instamart"]).toContain(channel);
      expect(actual.get(channel)!.fillRate!).toBeLessThan(0.95);
      expect(d.measurePlan.baseline).toBeCloseTo(actual.get(channel)!.fillRate! * 100, 6);
    }
    const below = [...actual.values()].filter((r) => r.fillRate! < 0.95 && r.ordered >= 100).map((r) => r.key).sort();
    expect(byRule("FILL_RATE_LOW").map((d) => d.dedupeKey.split("|")[1]).sort()).toEqual(below);
  });

  it("every finding is complete: action, evidence, formula, assumptions and a measurable plan", () => {
    for (const d of drafts) {
      expect(d.title && d.whatHappened && d.whyItMatters && d.suggestedAction && d.impactFormula, d.dedupeKey).toBeTruthy();
      expect(d.evidence.facts.length, d.dedupeKey).toBeGreaterThan(0);
      expect(d.assumptions.length, d.dedupeKey).toBeGreaterThan(0);
      expect(Number.isFinite(d.measurePlan.baseline) && Number.isFinite(d.measurePlan.target), d.dedupeKey).toBe(true);
      if (d.impactInr !== null) expect(Number.isFinite(d.impactInr), d.dedupeKey).toBe(true);
    }
    expect(new Set(drafts.map((d) => d.dedupeKey)).size).toBe(drafts.length);
  });

  it("is deterministic: same data, same findings", async () => {
    const again = await generateDrafts(db, tenantId, data.meta.periodTo);
    expect(JSON.stringify(again)).toBe(JSON.stringify(drafts));
  });
});

describe("lifecycle: refresh, owner decisions and measured outcomes", () => {
  it("refresh is idempotent", async () => {
    const first = await refreshFindings(db, tenantId, EARLY);
    expect(first.produced).toBeGreaterThan(0);
    expect(first.created).toBe(first.produced);
    const second = await refreshFindings(db, tenantId, EARLY);
    expect(second).toMatchObject({ created: 0, reopened: 0, resolved: 0, updated: first.produced });
  });

  it("owner decisions follow the allowed transitions and are audited", async () => {
    const margin = await db.finding.findFirstOrThrow({ where: { ruleId: "MARGIN_EROSION" } });
    const accepted = await actOnFinding(db, tenantId, margin.id, "accept", OWNER, "Will renegotiate with the pen supplier");
    const plan = accepted.measurePlan as MeasurePlan;
    expect(plan.startedOn).toBe(EARLY);
    expect(plan.checkOn).toBe("2026-06-29");
    await expect(actOnFinding(db, tenantId, margin.id, "snooze", OWNER)).rejects.toBeInstanceOf(FindingActionError);

    const slow = await db.finding.findFirstOrThrow({ where: { ruleId: "SLOW_MOVER_CAPITAL" }, orderBy: { impactInr: "desc" } });
    await actOnFinding(db, tenantId, slow.id, "accept", OWNER);
    const lapsing = await db.finding.findMany({ where: { ruleId: "LAPSING_KEY_CUSTOMER" }, orderBy: { dedupeKey: "asc" } });
    await actOnFinding(db, tenantId, lapsing[0].id, "dismiss", OWNER, "Customer closed their shop");
    const snoozed = await actOnFinding(db, tenantId, lapsing[1].id, "snooze", OWNER);
    expect(snoozed.snoozedUntil?.toISOString().slice(0, 10)).toBe("2026-04-30");

    expect(await db.auditLog.count({ where: { entity: "Finding" } })).toBe(4);
  });

  it("a later refresh keeps decisions, reopens expired snoozes and resolves what went away", async () => {
    const before = new Map((await db.finding.findMany()).map((f) => [f.id, f]));
    await refreshFindings(db, tenantId, data.meta.periodTo);
    const after = new Map((await db.finding.findMany()).map((f) => [f.id, f]));
    const produced = new Set(drafts.map((d) => d.dedupeKey));
    for (const [id, prev] of before) {
      const now = after.get(id)!;
      if (prev.status === "accepted" || prev.status === "dismissed") {
        // Owner decisions stand; accepted plans stay frozen at acceptance.
        expect(now.status).toBe(prev.status);
        if (prev.status === "accepted") expect(now.measurePlan).toEqual(prev.measurePlan);
      } else if (produced.has(prev.dedupeKey)) {
        // The snooze (until 2026-04-30) has expired by the data end, so it reopens.
        expect(now.status, prev.dedupeKey).toBe("open");
      } else {
        // No longer produced: resolved by the system, never deleted.
        expect(now.status, prev.dedupeKey).toBe("resolved");
        expect(now.statusChangedBy).toBe("system");
      }
    }
    const live = new Set([...after.values()].map((f) => f.dedupeKey));
    for (const key of produced) expect(live.has(key), key).toBe(true);
  });

  it("measures outcomes from later data, never from the estimate", async () => {
    expect((await measureOutcomes(db, tenantId, data.meta.periodTo)).measured).toBe(2);
    const outcomes = await db.findingOutcome.findMany({ include: { finding: true } });
    // Nobody acted in the demo data, so the planted problems persist and must be reported as not achieved.
    const margin = outcomes.find((o) => o.finding.ruleId === "MARGIN_EROSION")!;
    expect(margin.verdict).toBe("not_achieved");
    expect(margin.metricValue!.toNumber()).toBeLessThan((margin.finding.measurePlan as MeasurePlan).target);
    const slow = outcomes.find((o) => o.finding.ruleId === "SLOW_MOVER_CAPITAL")!;
    expect(slow.verdict).toBe("not_achieved");
    expect(slow.realisedImpactInr?.toNumber()).toBe(0);
    for (const o of outcomes) expect(o.notes).toContain("not proof");
    expect((await measureOutcomes(db, tenantId, data.meta.periodTo)).measured).toBe(0);
  });

  it("track record keeps estimates and realised figures apart", async () => {
    const record = await trackRecord(db);
    expect(record).toMatchObject({ accepted: 2, dismissed: 1, measured: 2, achieved: 0 });
    expect(record.estimatedImpactAccepted).toBeGreaterThan(0);
    // Realised can be negative (the margin kept falling); it is reported as measured, not floored.
    const outcomes = await db.findingOutcome.findMany();
    expect(record.realisedImpact).toBeCloseTo(outcomes.reduce((s, o) => s + (o.realisedImpactInr?.toNumber() ?? 0), 0), 2);
    expect(record.realisedImpact).toBeLessThan(0);
  });
});
