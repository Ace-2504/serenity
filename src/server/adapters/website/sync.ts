import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { convertWebsite, customerCode, indiaDate, type WebsiteSnapshot } from "@/server/adapters/website/convert";
import type { TenantDb } from "@/server/db/tenant";
import { commitImport, stageImport } from "@/server/ingest/pipeline";

/**
 * The link between this website and one business's books. Only one business can be linked: the
 * shop's own. Each sync re-reads the whole period from the shop's tables (they are small and
 * exact), saves it when it has no errors, and copies customers' marketing consent into the CRM.
 */

export const WEBSITE_SOURCE_NAME = "This website (orders, customers, purchases)";
export const websiteSettingsSchema = z.object({
  /** First day the books take from the website; default: the first order or purchase. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Save syncs without review when they have no errors. */
  autoCommit: z.boolean().default(true)
});

/** Reads everything the books need from the shop's own tables. */
export async function readWebsite(readAt = new Date()): Promise<WebsiteSnapshot> {
  const [variants, customers, orders, purchases] = await Promise.all([
    prisma.productVariant.findMany({
      include: { product: { include: { category: { select: { name: true } } } }, inventory: { select: { stockOnHand: true } } },
      orderBy: { sku: "asc" }
    }),
    prisma.user.findMany({
      // Shop accounts, and anyone else (e.g. staff testing the checkout) who has placed an order.
      where: { OR: [{ userRoles: { some: { role: { code: "customer" } } } }, { orders: { some: {} } }] },
      select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } }, addresses: { orderBy: [{ isDefault: "desc" }], take: 1, select: { phone: true, city: true } } }
    }),
    prisma.order.findMany({ include: { items: true, payments: true }, orderBy: { placedAt: "asc" } }),
    prisma.purchaseBill.findMany({ include: { supplier: true, lines: true }, orderBy: { billDate: "asc" } })
  ]);
  return {
    readAt,
    variants: variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      title: v.product.title,
      attributes: v.attributesJson,
      category: v.product.category.name,
      hsnCode: v.product.hsnCode,
      gstPercent: v.product.gstPercent,
      costPricePaise: v.costPricePaise,
      stockOnHand: v.inventory?.stockOnHand ?? null
    })),
    customers: customers.map((c) => ({
      id: c.id,
      email: c.email,
      name: [c.profile?.firstName, c.profile?.lastName].filter(Boolean).join(" "),
      phone: c.addresses[0]?.phone ?? "",
      city: c.addresses[0]?.city ?? ""
    })),
    orders: orders.map((o) => ({
      orderNumber: o.orderNumber,
      userId: o.userId,
      status: o.status,
      paymentStatus: o.paymentStatus,
      placedAt: o.placedAt,
      updatedAt: o.updatedAt,
      shippingTotalInr: o.shippingTotalInr,
      discountTotalInr: o.discountTotalInr,
      grandTotalInr: o.grandTotalInr,
      paidAt: o.paymentMethod === "cod" ? (o.payments.find((p) => p.provider === "internal-cod" && p.status === "captured")?.updatedAt ?? o.placedAt) : o.placedAt,
      items: o.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitPriceInr: i.unitPriceInr, taxPercent: i.taxPercent, taxAmountInr: i.taxAmountInr })),
      gatewayFees: o.payments.flatMap((p) => {
        // Razorpay reports its fee and the GST on it (paise) on captured payments; use them only when present.
        const raw = (p.rawPayloadJson as { razorpayPayment?: { fee?: unknown; tax?: unknown } } | null)?.razorpayPayment;
        return p.status === "captured" && typeof raw?.fee === "number" && raw.fee > 0
          ? [{ ref: p.providerPaymentId ?? p.id, date: p.createdAt, feePaise: raw.fee, taxPaise: typeof raw.tax === "number" ? raw.tax : 0 }]
          : [];
      })
    })),
    purchases: purchases.map((b) => ({
      id: b.id,
      supplier: { id: b.supplier.id, name: b.supplier.name, gstin: b.supplier.gstin, phone: b.supplier.phone, email: b.supplier.email, city: b.supplier.city, creditDays: b.supplier.creditDays },
      billNumber: b.billNumber,
      billDate: b.billDate,
      paidOn: b.paidOn,
      lines: b.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, unitCostPaise: l.unitCostPaise, gstPercent: l.gstPercent }))
    }))
  };
}

export type WebsiteSyncResult = { batchId: string; status: string; committed: boolean; errors: number; warnings: number; from: string; to: string; consentsAdded: number };

export async function syncWebsite(db: TenantDb, tenantId: string, dataSourceId: string, options: { userId?: string; onStep?: (step: string) => void; now?: Date } = {}): Promise<WebsiteSyncResult> {
  const source = await db.dataSource.findFirst({ where: { id: dataSourceId, kind: "storefront" } });
  if (!source) throw new Error("This business is not linked to the website");
  const settings = websiteSettingsSchema.parse(source.settings ?? {});
  options.onStep?.("read website");
  const snapshot = await readWebsite(options.now);
  const to = indiaDate(snapshot.readAt);
  const firsts = [...snapshot.orders.map((o) => indiaDate(o.placedAt)), ...snapshot.purchases.map((b) => indiaDate(b.billDate))].sort();
  const from = settings.from ?? firsts[0] ?? to;
  const conversion = convertWebsite(snapshot, { from, to });

  options.onStep?.("stage");
  const staged = await stageImport(db, {
    tenantId,
    dataSourceId,
    files: conversion.files,
    userId: options.userId,
    adapter: {
      issues: conversion.issues,
      summary: {
        name: "This website",
        verified: true,
        note: "Read directly from this website's orders, customers, products, stock and purchase bills.",
        details: conversion.summary
      }
    }
  });
  const errors = staged.summary.issues.errors;
  let committed = false;
  if (staged.status === "validated" && errors === 0 && settings.autoCommit) {
    await commitImport(db, tenantId, staged.batchId, { userId: options.userId, onStep: options.onStep });
    committed = true;
  }
  if (committed || staged.status === "duplicate") await linkItemsToVariants(db, dataSourceId, snapshot);
  if (staged.status === "duplicate") await db.dataSource.update({ where: { id: dataSourceId }, data: { lastSuccessfulSyncAt: new Date() } });
  const consentsAdded = await copyConsents(db, tenantId, dataSourceId);
  return { batchId: staged.batchId, status: staged.status, committed, errors, warnings: staged.summary.issues.warnings, from, to, consentsAdded };
}

/**
 * Customers who ticked "email me offers" on the website are recorded as having agreed, once. After
 * that the CRM's log is the record: an unsubscribe there is never overwritten by the website.
 */
export async function copyConsents(db: TenantDb, tenantId: string, dataSourceId: string): Promise<number> {
  const agreed = await prisma.user.findMany({ where: { marketingEmailConsentAt: { not: null } }, select: { id: true, marketingEmailConsentAt: true } });
  if (agreed.length === 0) return 0;
  const parties = await db.party.findMany({ where: { dataSourceId, sourceKey: { in: agreed.map((u) => customerCode(u.id)) } }, select: { id: true, sourceKey: true } });
  const recorded = new Set((await db.contactConsent.findMany({ where: { channel: "email", source: "website", partyId: { in: parties.map((p) => p.id) } }, select: { partyId: true } })).map((c) => c.partyId));
  const byCode = new Map(agreed.map((u) => [customerCode(u.id), u.marketingEmailConsentAt!]));
  const fresh = parties.filter((p) => !recorded.has(p.id));
  if (fresh.length) {
    await db.contactConsent.createMany({
      data: fresh.map((p) => ({ tenantId, partyId: p.id, channel: "email", status: "granted", source: "website", evidence: "Ticked 'Email me offers' when creating a shop account", recordedAt: byCode.get(p.sourceKey)! }))
    });
  }
  return fresh.length;
}

/** Points each book item at the website variant with its SKU, so the ERP can link back to the shop. */
async function linkItemsToVariants(db: TenantDb, dataSourceId: string, snapshot: WebsiteSnapshot) {
  const items = await db.item.findMany({ where: { dataSourceId, variantId: null }, select: { id: true, sourceKey: true } });
  const bySku = new Map(snapshot.variants.map((v) => [v.sku, v.id]));
  for (const item of items) {
    const variantId = bySku.get(item.sourceKey);
    if (variantId) await db.item.update({ where: { id: item.id }, data: { variantId } });
  }
}
