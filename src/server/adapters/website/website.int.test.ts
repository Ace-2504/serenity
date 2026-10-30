import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { customerCode } from "@/server/adapters/website/convert";
import { syncWebsite } from "@/server/adapters/website/sync";
import { forTenant } from "@/server/db/tenant";
import { moveOrder } from "@/server/orders/status";
import type { ImportSummary } from "@/server/ingest/pipeline";

/**
 * The shop's own records become the linked business's books: orders, returns, payments, customers
 * with their marketing consent, purchase bills, and stock that agrees with the shop's count.
 */

const tag = randomUUID().slice(0, 8);
const ids = { users: [] as string[], products: [] as string[], category: "", brand: "", supplier: "", tenant: "", source: "", owner: "" };
const variant: Record<string, string> = {};
const orders: Record<string, string> = {};

async function customer(name: string, consent: boolean) {
  const role = await prisma.role.upsert({ where: { code: "customer" }, update: {}, create: { code: "customer", name: "Customer" } });
  const u = await prisma.user.create({
    data: {
      email: `${name.toLowerCase()}-${tag}@example.com`,
      passwordHash: "x:y",
      marketingEmailConsentAt: consent ? new Date("2026-09-01T10:00:00Z") : null,
      profile: { create: { firstName: name, lastName: "Test" } },
      addresses: { create: { label: "Home", line1: "1 Road", city: "Pune", state: "MH", postalCode: "411001", country: "India", phone: "9800000000", isDefault: true } },
      userRoles: { create: { roleId: role.id } }
    }
  });
  ids.users.push(u.id);
  return u.id;
}

async function order(key: string, userId: string, status: "confirmed" | "delivered" | "cancelled" | "returned", paid: boolean, placedAt: string, lines: [string, number, number][]) {
  const items = lines.map(([sku, qty, price]) => ({ variantId: variant[sku], titleSnapshot: sku, skuSnapshot: sku, quantity: qty, unitPriceInr: price, taxPercent: 18, taxAmountInr: Math.round(qty * price * 0.18), lineTotalInr: qty * price + Math.round(qty * price * 0.18) }));
  const sub = items.reduce((s, i) => s + i.quantity * i.unitPriceInr, 0);
  const tax = items.reduce((s, i) => s + i.taxAmountInr, 0);
  const o = await prisma.order.create({
    data: {
      orderNumber: `T${tag}-${key}`,
      userId,
      status,
      subtotalInr: sub,
      taxTotalInr: tax,
      grandTotalInr: sub + tax,
      paymentMethod: paid ? "upi" : "cod",
      paymentStatus: paid ? "paid" : "cod_pending",
      shippingAddressSnapshot: {},
      billingAddressSnapshot: {},
      placedAt: new Date(placedAt),
      items: { create: items }
    }
  });
  orders[key] = o.id;
}

beforeAll(async () => {
  const category = await prisma.category.create({ data: { name: `Notebooks ${tag}`, slug: `nb-${tag}` } });
  const brand = await prisma.brand.create({ data: { name: `Brand ${tag}`, slug: `br-${tag}` } });
  ids.category = category.id;
  ids.brand = brand.id;
  for (const [sku, stock] of [[`NB-${tag}`, 40], [`PEN-${tag}`, 5]] as const) {
    const p = await prisma.product.create({
      data: {
        title: sku,
        slug: sku.toLowerCase(),
        description: "",
        categoryId: category.id,
        brandId: brand.id,
        hsnCode: "4820",
        gstPercent: 18,
        status: "published",
        variants: { create: { sku, attributesJson: { colour: "Blue" }, priceInr: 100, costPricePaise: 6000, inventory: { create: { stockOnHand: stock, lowStockThreshold: 2 } } } }
      },
      include: { variants: true }
    });
    ids.products.push(p.id);
    variant[sku.split("-")[0]] = p.variants[0].id;
  }
  variant[`NB-${tag}`] = variant.NB;
  variant[`PEN-${tag}`] = variant.PEN;

  const asha = await customer("Asha", true);
  const ravi = await customer("Ravi", false);
  await order("1", asha, "confirmed", true, "2026-10-01T06:00:00Z", [[`NB-${tag}`, 3, 100]]);
  await order("2", ravi, "delivered", false, "2026-10-02T06:00:00Z", [[`PEN-${tag}`, 2, 50]]);
  await order("3", ravi, "cancelled", true, "2026-10-03T06:00:00Z", [[`NB-${tag}`, 1, 100]]);
  await order("4", asha, "returned", true, "2026-10-04T06:00:00Z", [[`NB-${tag}`, 1, 100]]);

  const owner = await prisma.user.create({ data: { email: `owner-${tag}@example.com`, passwordHash: "x:y" } });
  ids.owner = owner.id;
  ids.users.push(owner.id);
  const supplier = await prisma.supplier.create({ data: { name: `Kagaz Mills ${tag}`, gstin: "27ABCDE1234F1Z5", creditDays: 30 } });
  ids.supplier = supplier.id;
  await prisma.purchaseBill.create({
    data: { supplierId: supplier.id, billNumber: "KM-1", billDate: new Date("2026-10-05"), paidOn: new Date("2026-10-06"), createdById: owner.id, lines: { create: { variantId: variant.NB, quantity: 10, unitCostPaise: 6000, gstPercent: 18 } } }
  });

  const tenant = await prisma.tenant.create({ data: { name: `Website books ${tag}`, domainPack: "stationery", memberships: { create: { userId: owner.id, role: "owner_admin" } } } });
  ids.tenant = tenant.id;
  ids.source = (await prisma.dataSource.create({ data: { tenantId: tenant.id, kind: "storefront", name: "This website", settings: { autoCommit: true, from: "2026-10-01" } } })).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: ids.tenant } });
  await prisma.purchaseBill.deleteMany({ where: { supplierId: ids.supplier } });
  await prisma.supplier.deleteMany({ where: { id: ids.supplier } });
  await prisma.order.deleteMany({ where: { id: { in: Object.values(orders) } } });
  await prisma.product.deleteMany({ where: { id: { in: ids.products } } });
  await prisma.category.deleteMany({ where: { id: ids.category } });
  await prisma.brand.deleteMany({ where: { id: ids.brand } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
});

describe("website feed into the books", () => {
  it("saves the shop's orders, returns, payments and purchases with stock agreeing with the shop", async () => {
    const db = forTenant(ids.tenant);
    const result = await syncWebsite(db, ids.tenant, ids.source, { now: new Date("2026-10-10T06:00:00Z") });
    expect(result).toMatchObject({ committed: true, errors: 0, from: "2026-10-01", to: "2026-10-10" });

    const vouchers = await db.voucher.findMany({ where: { dataSourceId: ids.source, status: "active" }, select: { type: true, number: true } });
    const mine = vouchers.filter((v) => v.number.includes(tag));
    // Orders 1, 2 and 4 are sales; 4 also comes back; the cancelled order 3 is not a sale.
    expect(mine.filter((v) => v.type === "sales_invoice").map((v) => v.number).sort()).toEqual([`T${tag}-1`, `T${tag}-2`, `T${tag}-4`]);
    expect(mine.filter((v) => v.type === "sales_return").map((v) => v.number)).toEqual([`RET-T${tag}-4`]);
    expect(mine.filter((v) => v.type === "purchase_invoice")).toHaveLength(1);

    // Paid online orders are settled; cash on delivery stays owed.
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    const summary = batch.counts as unknown as ImportSummary;
    expect(summary.ledger?.stockCheck.qtyMismatches).toBe(0);
    // The adapter's note survives the save, so the import still says where its data came from.
    expect(summary.adapter).toMatchObject({ name: "This website", verified: true });

    // The books link back to the shop's variants.
    const item = await db.item.findFirstOrThrow({ where: { dataSourceId: ids.source, sourceKey: `NB-${tag}` } });
    expect(item.variantId).toBe(variant.NB);
    // NB opens at 40 now + 3 + 1 sold - 1 returned - 10 bought = 33 on 1 October, and ends at the shop's 40.
    const moves = await db.stockMovement.findMany({ where: { itemId: item.id }, orderBy: [{ date: "asc" }, { seq: "asc" }] });
    expect(Number(moves[0].qtyIn)).toBe(33);
    expect(Number(moves.at(-1)!.runningQty)).toBe(40);
  });

  it("copies marketing consent once, and never over an unsubscribe", async () => {
    const db = forTenant(ids.tenant);
    const parties = await db.party.findMany({ where: { dataSourceId: ids.source, sourceKey: { in: ids.users.map(customerCode) } }, select: { id: true, sourceKey: true } });
    const asha = parties.find((p) => p.sourceKey === customerCode(ids.users[0]))!;
    const ravi = parties.find((p) => p.sourceKey === customerCode(ids.users[1]))!;
    const consents = await db.contactConsent.findMany({ where: { partyId: { in: [asha.id, ravi.id] } } });
    expect(consents.map((c) => [c.partyId, c.status])).toEqual([[asha.id, "granted"]]);

    await db.contactConsent.create({ data: { tenantId: ids.tenant, partyId: asha.id, channel: "email", status: "revoked", source: "unsubscribe_link" } });
    const again = await syncWebsite(db, ids.tenant, ids.source, { now: new Date("2026-10-10T06:00:00Z") });
    expect(again.status).toBe("duplicate");
    expect(again.consentsAdded).toBe(0);
  });

  it("drops an order from the books when the shop cancels it, with its stock back on the shelf", async () => {
    const db = forTenant(ids.tenant);
    await expect(moveOrder(orders["2"], "cancelled")).rejects.toThrow(/cannot become cancelled/);
    await moveOrder(orders["1"], "cancelled");
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { variantId: variant.NB } })).stockOnHand).toBe(43);

    const result = await syncWebsite(db, ids.tenant, ids.source, { now: new Date("2026-10-10T06:00:00Z") });
    expect(result.committed).toBe(true);
    const sale = await db.voucher.findFirstOrThrow({ where: { dataSourceId: ids.source, number: `T${tag}-1` } });
    expect(sale.status).toBe("deleted_at_source");
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect((batch.counts as unknown as ImportSummary).ledger?.stockCheck.qtyMismatches).toBe(0);
  });
});
