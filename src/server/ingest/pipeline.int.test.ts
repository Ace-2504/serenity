import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { generateDemoDataset, type DemoDataset } from "@/server/demo/engine";
import { datasetToFiles } from "@/server/demo/files";
import type { DemoProfile } from "@/server/demo/profile";
import { stationeryDemoProfile } from "@/server/demo/profiles/stationery";
import { commitImport, ImportError, stageImport } from "@/server/ingest/pipeline";
import { formatPaise, parsePaise } from "@/server/ingest/template";

/** Four months and a fraction of the customers and items: same shape as the full demo, fast to import. */
const smallProfile: DemoProfile = {
  ...stationeryDemoProfile,
  end: "2025-01-31",
  groups: stationeryDemoProfile.groups.map((g) => ({ ...g, count: Math.min(g.count, 6) })),
  segments: stationeryDemoProfile.segments.map((s) => ({ ...s, count: Math.min(s.count, 12) }))
};

const tenants: string[] = [];

async function newTenant(domainPack = "stationery") {
  const tenant = await prisma.tenant.create({ data: { name: "Import test", domainPack, isDemo: true } });
  tenants.push(tenant.id);
  const db = forTenant(tenant.id);
  const source = await db.dataSource.create({ data: { tenantId: tenant.id, kind: "csv_template", name: "Template upload" } });
  return { db, tenantId: tenant.id, dataSourceId: source.id };
}

const clone = (d: DemoDataset): DemoDataset => structuredClone(d);
const adjustControl = (d: DemoDataset, metric: string, deltaPaise: number) => {
  const row = d.controlTotals.find((c) => c.metric === metric)!;
  row.value = formatPaise(parsePaise(row.value) + deltaPaise);
};
const salesTaxable = async (db: ReturnType<typeof forTenant>) =>
  (await db.voucherLine.aggregate({ where: { voucher: { type: "sales_invoice", status: "active" } }, _sum: { taxableAmount: true } }))._sum.taxableAmount?.toFixed(2);

let base: DemoDataset;

beforeAll(() => {
  base = generateDemoDataset(smallProfile, 42);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
  await prisma.$disconnect();
});

describe("staging and committing a template bundle", () => {
  let t: Awaited<ReturnType<typeof newTenant>>;
  let firstBatch: string;

  beforeAll(async () => {
    t = await newTenant();
  });

  it("stages a valid bundle with a preview of what will change", async () => {
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(base) });
    firstBatch = staged.batchId;
    expect(staged.status).toBe("validated");
    expect(staged.summary.issues.errors).toBe(0);
    const invoices = new Set(base.vouchers.map((v) => `${v.voucher_type}|${v.voucher_no}`)).size;
    expect(staged.summary.entities.voucher).toEqual({ new: invoices, changed: 0, unchanged: 0, deletedAtSource: 0 });
    expect(await t.db.voucher.count()).toBe(0);
  });

  it("commits in one transaction and reconciles the database to the control totals", async () => {
    const result = await commitImport(t.db, t.tenantId, firstBatch);
    expect(result.reconciliation.length).toBe(8);
    expect(result.reconciliation.filter((r) => !r.ok)).toEqual([]);

    const control = (metric: string) => base.controlTotals.find((c) => c.metric === metric)!.value;
    expect(await salesTaxable(t.db)).toBe(control("sales_taxable"));
    const settled = await t.db.billAllocation.aggregate({ _sum: { amount: true } });
    expect(settled._sum.amount?.toFixed(2)).toBe(formatPaise(parsePaise(control("receipts")) + parsePaise(control("payments"))));
    expect(await t.db.channelCharge.count()).toBe(base.channelCharges.length);
    expect(await t.db.channelCharge.count({ where: { orderVoucherId: null, chargeType: { not: "tds_income_tax" } } })).toBe(0);
    expect(await t.db.stockSnapshot.count()).toBe(base.stockSummary.length);
    expect(await t.db.outstandingSnapshot.count()).toBe(base.outstanding.length);

    const batch = await t.db.importBatch.findUniqueOrThrow({ where: { id: firstBatch } });
    expect(batch.status).toBe("committed");
    expect(await t.db.auditLog.count({ where: { action: "import.commit", entityId: firstBatch } })).toBe(1);
    expect((await t.db.dataSource.findUniqueOrThrow({ where: { id: t.dataSourceId } })).lastSuccessfulSyncAt).not.toBeNull();
  });

  it("links returns to their original invoices and marketplace charges to their orders", async () => {
    const returns = await t.db.voucher.findMany({ where: { type: "sales_return" }, select: { originalVoucherId: true } });
    expect(returns.length).toBeGreaterThan(0);
    expect(returns.every((r) => r.originalVoucherId !== null)).toBe(true);
    const anonymous = await t.db.party.findMany({ where: { anonymousBuyers: true }, select: { sourceKey: true } });
    expect(anonymous.map((p) => p.sourceKey).sort()).toEqual(["CASH-001", "MKT-AMZ-001", "MKT-MSH-001"]);
  });

  it("treats re-uploading the same files as a no-op", async () => {
    const before = await t.db.sourceRecord.count();
    const again = await stageImport(t.db, { ...t, files: datasetToFiles(base) });
    expect(again).toMatchObject({ status: "duplicate", batchId: firstBatch });
    expect(await t.db.sourceRecord.count()).toBe(before);
    expect(await t.db.importBatch.count()).toBe(1);
  });

  let corrected: DemoDataset;

  it("turns a corrected invoice into a new version without disturbing anything else", async () => {
    corrected = clone(base);
    const row = corrected.vouchers.find((v) => v.voucher_type === "sales_invoice" && v.channel === "direct")!;
    const before = { taxable: parsePaise(row.taxable_amount), tax: parsePaise(row.tax_amount) };
    row.qty = String(Number(row.qty) + 1);
    const taxable = Number(row.qty) * parsePaise(row.rate) - parsePaise(row.discount_amount);
    row.taxable_amount = formatPaise(taxable);
    row.tax_amount = formatPaise(Math.round((taxable * Number(row.gst_rate)) / 100));
    adjustControl(corrected, "sales_taxable", taxable - before.taxable);
    adjustControl(corrected, "sales_tax", parsePaise(row.tax_amount) - before.tax);

    const existing = await t.db.voucher.findFirstOrThrow({ where: { type: "sales_invoice", number: row.voucher_no } });
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(corrected) });
    expect(staged.status).toBe("validated");
    expect(staged.summary.entities.voucher).toMatchObject({ changed: 1, new: 0, deletedAtSource: 0 });
    await commitImport(t.db, t.tenantId, staged.batchId);

    const after = await t.db.voucher.findUniqueOrThrow({ where: { id: existing.id }, include: { lines: true } });
    expect(after.sourceVersion).toBe(2);
    expect(after.lines.find((l) => l.lineNo === Number(row.line_no))?.qty.toFixed()).toBe(row.qty);
    const versions = await t.db.sourceRecord.findMany({ where: { entity: "voucher", sourceKey: `sales_invoice|${row.voucher_no}` }, orderBy: { version: "asc" } });
    expect(versions.map((v) => [v.version, v.supersededAt === null])).toEqual([
      [1, false],
      [2, true]
    ]);
    expect(await salesTaxable(t.db)).toBe(corrected.controlTotals.find((c) => c.metric === "sales_taxable")!.value);
  });

  it("marks an invoice missing from a later full-period file as deleted at source, and restores it when it returns", async () => {
    const dropped = clone(corrected);
    const returned = new Set(dropped.vouchers.filter((v) => v.voucher_type === "sales_return").map((v) => v.original_voucher_no));
    const target = dropped.vouchers.find((v) => v.voucher_type === "sales_invoice" && v.channel === "direct" && !returned.has(v.voucher_no))!.voucher_no;
    const lines = dropped.vouchers.filter((v) => v.voucher_no === target);
    dropped.vouchers = dropped.vouchers.filter((v) => v.voucher_no !== target);
    adjustControl(dropped, "sales_taxable", -lines.reduce((s, l) => s + parsePaise(l.taxable_amount), 0));
    adjustControl(dropped, "sales_tax", -lines.reduce((s, l) => s + parsePaise(l.tax_amount), 0));
    const allocations = dropped.settlements.filter((s) => s.against_voucher_no === target);
    dropped.settlements = dropped.settlements.filter((s) => s.against_voucher_no !== target);
    adjustControl(dropped, "receipts", -allocations.reduce((s, a) => s + parsePaise(a.amount), 0));
    dropped.outstanding = dropped.outstanding.filter((o) => o.bill_ref !== target);

    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(dropped) });
    expect(staged.status).toBe("validated");
    expect(staged.summary.entities.voucher.deletedAtSource).toBe(1);
    expect(staged.summary.issues.byCode.MISSING_FROM_SOURCE?.count).toBe(1);
    await commitImport(t.db, t.tenantId, staged.batchId);
    expect((await t.db.voucher.findFirstOrThrow({ where: { type: "sales_invoice", number: target } })).status).toBe("deleted_at_source");

    // Uploading the earlier file again is a real change now, not a duplicate.
    const restore = await stageImport(t.db, { ...t, files: datasetToFiles(corrected) });
    expect(restore.status).toBe("validated");
    const committed = await commitImport(t.db, t.tenantId, restore.batchId);
    expect(committed.reconciliation.every((r) => r.ok)).toBe(true);
    expect((await t.db.voucher.findFirstOrThrow({ where: { type: "sales_invoice", number: target } })).status).toBe("active");
  });
});

describe("failure handling", () => {
  it("leaves nothing behind when a commit is interrupted, and can be retried", async () => {
    const t = await newTenant();
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(base) });
    await expect(
      commitImport(t.db, t.tenantId, staged.batchId, {
        onStep: (step) => {
          if (step === "lines") throw new Error("simulated crash while writing lines");
        }
      })
    ).rejects.toThrow("simulated crash");

    const batch = await t.db.importBatch.findUniqueOrThrow({ where: { id: staged.batchId } });
    expect(batch.status).toBe("failed");
    expect(batch.error).toContain("simulated crash");
    expect(await t.db.sourceRecord.count()).toBe(0);
    expect(await t.db.voucher.count()).toBe(0);
    expect(await t.db.party.count()).toBe(0);

    const retried = await commitImport(t.db, t.tenantId, staged.batchId);
    expect(retried.status).toBe("committed");
  });

  it("refuses to commit a bundle with errors, and stores the issues for review", async () => {
    const t = await newTenant();
    const broken = clone(base);
    adjustControl(broken, "sales_taxable", 100_00);
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(broken) });
    expect(staged.status).toBe("rejected");
    const issue = await t.db.importIssue.findFirstOrThrow({ where: { importBatchId: staged.batchId, code: "CONTROL_TOTAL_MISMATCH" } });
    expect(issue.message).toContain("difference -100.00");
    await expect(commitImport(t.db, t.tenantId, staged.batchId)).rejects.toMatchObject({ code: "NOT_COMMITTABLE" });
    expect(await t.db.voucher.count()).toBe(0);
  });

  it("rejects item attributes that the tenant's domain pack does not allow", async () => {
    const t = await newTenant();
    const bad = clone(base);
    bad.items[0].attributes_json = JSON.stringify({ expiryDate: "2027-01-01" });
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(bad) });
    expect(staged.status).toBe("rejected");
    expect(staged.summary.issues.byCode.INVALID_ATTRIBUTES?.count).toBe(1);
  });

  it("lets exactly one of two concurrent commits of the same import succeed", async () => {
    const t = await newTenant();
    const staged = await stageImport(t.db, { ...t, files: datasetToFiles(base) });
    const results = await Promise.allSettled([commitImport(t.db, t.tenantId, staged.batchId), commitImport(t.db, t.tenantId, staged.batchId)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(ImportError);
    expect((failure.reason as ImportError).code).toBe("NOT_COMMITTABLE");
    expect(await t.db.voucher.count({ where: { type: "opening_stock" } })).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("does not let another tenant see or commit an import", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const staged = await stageImport(a.db, { ...a, files: datasetToFiles(base) });
    expect(await b.db.importBatch.findUnique({ where: { id: staged.batchId } })).toBeNull();
    expect(await b.db.importFile.count()).toBe(0);
    await expect(commitImport(b.db, b.tenantId, staged.batchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("schema health", () => {
  it("has an index behind every foreign key on platform tables", async () => {
    const storefront = ["UserRole", "Address", "Product", "ProductVariant", "CartItem", "Order", "OrderItem", "BulkRequest"];
    const missing = await prisma.$queryRaw<{ tbl: string; conname: string }[]>(Prisma.sql`
      select c.conrelid::regclass::text as tbl, c.conname
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (select array_agg(x order by x) from unnest(c.conkey) x) =
                (select array_agg(y order by y) from unnest((i.indkey::int2[])[0:array_length(c.conkey, 1) - 1]) y)
        )`);
    // Storefront tables predate the platform; their missing indexes are tracked as debt.
    expect(missing.filter((m) => !storefront.includes(m.tbl.replace(/"/g, "")))).toEqual([]);
  });
});
