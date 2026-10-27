import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { forTenant, TenantScopeError } from "@/server/db/tenant";

type Seeded = { tenantId: string; partyId: string; itemId: string; voucherId: string };

async function seedTenant(name: string): Promise<Seeded> {
  const tenant = await prisma.tenant.create({ data: { name, domainPack: "stationery" } });
  const db = forTenant(tenant.id);
  const source = await db.dataSource.create({ data: { tenantId: tenant.id, kind: "csv_template", name: "Template" } });
  const batch = await db.importBatch.create({ data: { tenantId: tenant.id, dataSourceId: source.id } });
  const record = (entity: string, sourceKey: string) =>
    db.sourceRecord.create({
      data: {
        tenantId: tenant.id,
        dataSourceId: source.id,
        importBatchId: batch.id,
        entity,
        sourceKey,
        version: 1,
        contentHash: randomUUID(),
        payload: {}
      }
    });

  const party = await db.party.create({
    data: {
      tenantId: tenant.id,
      dataSourceId: source.id,
      sourceKey: "P1",
      sourceRecordId: (await record("party", "P1")).id,
      name: `${name} customer`,
      kind: "customer"
    }
  });
  const item = await db.item.create({
    data: {
      tenantId: tenant.id,
      dataSourceId: source.id,
      sourceKey: "I1",
      sourceRecordId: (await record("item", "I1")).id,
      name: "A5 ruled notebook",
      uom: "pcs"
    }
  });
  const voucher = await db.voucher.create({
    data: {
      tenantId: tenant.id,
      dataSourceId: source.id,
      sourceKey: "INV-1",
      sourceRecordId: (await record("voucher", "INV-1")).id,
      type: "sales_invoice",
      number: "INV-1",
      date: new Date("2026-06-15"),
      partyId: party.id,
      grossAmount: new Prisma.Decimal("1000.00"),
      taxableAmount: new Prisma.Decimal("1000.00"),
      taxAmount: new Prisma.Decimal("120.00"),
      totalInclTax: new Prisma.Decimal("1120.00"),
      lines: {
        create: [
          {
            lineNo: 1,
            itemId: item.id,
            qty: new Prisma.Decimal("40"),
            rate: new Prisma.Decimal("25"),
            grossAmount: new Prisma.Decimal("1000.00"),
            taxableAmount: new Prisma.Decimal("1000.00"),
            taxRate: new Prisma.Decimal("12"),
            taxAmount: new Prisma.Decimal("120.00")
          }
        ]
      }
    }
  });

  return { tenantId: tenant.id, partyId: party.id, itemId: item.id, voucherId: voucher.id };
}

let a: Seeded;
let b: Seeded;

beforeAll(async () => {
  a = await seedTenant(`A-${randomUUID()}`);
  b = await seedTenant(`B-${randomUUID()}`);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a.tenantId, b.tenantId] } } });
  await prisma.$disconnect();
});

describe("tenant isolation through forTenant()", () => {
  it("lists only the caller's rows", async () => {
    const vouchers = await forTenant(a.tenantId).voucher.findMany();
    expect(vouchers.map((v) => v.id)).toEqual([a.voucherId]);
  });

  it("cannot fetch another tenant's row by primary key", async () => {
    expect(await forTenant(a.tenantId).voucher.findUnique({ where: { id: b.voucherId } })).toBeNull();
  });

  it("cannot bulk-update or delete another tenant's rows", async () => {
    const updated = await forTenant(a.tenantId).party.updateMany({ where: {}, data: { city: "Noida" } });
    expect(updated.count).toBe(1);
    expect((await prisma.party.findUniqueOrThrow({ where: { id: b.partyId } })).city).toBeNull();

    const deleted = await forTenant(a.tenantId).auditLog.deleteMany({ where: {} });
    expect(deleted.count).toBe(0);
  });

  it("nested lines created under a voucher inherit its tenant", async () => {
    const lines = await prisma.voucherLine.findMany({ where: { voucherId: a.voucherId } });
    expect(lines).toHaveLength(1);
    expect(lines[0].tenantId).toBe(a.tenantId);
  });

  it("aggregates stay within the tenant", async () => {
    const totals = await forTenant(a.tenantId).voucherLine.aggregate({ _sum: { taxableAmount: true } });
    expect(totals._sum.taxableAmount?.toFixed(2)).toBe("1000.00");
  });

  it("keeps scoping inside interactive transactions", async () => {
    const db = forTenant(a.tenantId);
    const count = await db.$transaction(async (tx) => tx.voucher.count());
    expect(count).toBe(1);
  });

  it("refuses to create rows for another tenant", async () => {
    await expect(
      forTenant(a.tenantId).auditLog.create({ data: { tenantId: b.tenantId, action: "x", entity: "y" } })
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("tenant isolation enforced by the database", () => {
  it("rejects a voucher line pointing at another tenant's item, even via the raw client", async () => {
    await expect(
      prisma.voucherLine.create({
        data: {
          tenantId: a.tenantId,
          voucherId: a.voucherId,
          lineNo: 2,
          itemId: b.itemId,
          qty: new Prisma.Decimal("1"),
          rate: new Prisma.Decimal("1"),
          grossAmount: new Prisma.Decimal("1"),
          taxableAmount: new Prisma.Decimal("1")
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects a voucher pointing at another tenant's party", async () => {
    await expect(
      prisma.voucher.update({ where: { id: a.voucherId }, data: { partyId: b.partyId } })
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
