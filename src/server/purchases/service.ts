import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * ERP purchases: a supplier's bill for stock received. Recording one adds its quantities to the
 * shop's stock and sets each product's cost to the bill's rate, so the books (through the website
 * link) know what goods cost. Amounts are paise, excluding GST.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-28");
export const purchaseInput = z.object({
  supplier: z.union([
    z.object({ id: z.string().uuid() }),
    z.object({
      name: z.string().trim().min(2).max(120),
      gstin: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z0-9]{13}$/, "A GSTIN has 15 characters and starts with the state code")]).optional(),
      creditDays: z.number().int().min(0).max(365).default(0)
    })
  ]),
  billNumber: z.string().trim().min(1).max(40),
  billDate: date,
  paidOn: z.union([z.literal(""), date]).optional(),
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(1_000_000), unitCostPaise: z.number().int().min(0).max(1_000_000_000), gstPercent: z.number().int().min(0).max(50) }))
    .min(1, "Add at least one product")
    .max(200)
});
export type PurchaseInput = z.infer<typeof purchaseInput>;

export class PurchaseError extends Error {}

export async function recordPurchase(input: PurchaseInput, userId: string) {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  if (input.billDate > today) throw new PurchaseError("The bill date is in the future");
  if (input.paidOn && input.paidOn < input.billDate) throw new PurchaseError("The bill cannot be paid before its date");
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  if (variantIds.length !== input.lines.length) throw new PurchaseError("Each product may appear once on a bill");

  try {
    return await prisma.$transaction(async (tx) => {
      const found = await tx.productVariant.count({ where: { id: { in: variantIds } } });
      if (found !== variantIds.length) throw new PurchaseError("A product on the bill no longer exists");
      const supplier =
        "id" in input.supplier
          ? await tx.supplier.findUnique({ where: { id: input.supplier.id } })
          : await tx.supplier.upsert({
              where: { name: input.supplier.name },
              update: {},
              create: { name: input.supplier.name, gstin: input.supplier.gstin || null, creditDays: input.supplier.creditDays }
            });
      if (!supplier) throw new PurchaseError("Supplier not found");
      const bill = await tx.purchaseBill.create({
        data: {
          supplierId: supplier.id,
          billNumber: input.billNumber,
          billDate: new Date(`${input.billDate}T00:00:00Z`),
          paidOn: input.paidOn ? new Date(`${input.paidOn}T00:00:00Z`) : null,
          createdById: userId,
          lines: { create: input.lines }
        }
      });
      for (const line of input.lines) {
        await tx.inventoryItem.upsert({
          where: { variantId: line.variantId },
          update: { stockOnHand: { increment: line.quantity } },
          create: { variantId: line.variantId, stockOnHand: line.quantity, lowStockThreshold: 0 }
        });
        await tx.productVariant.update({ where: { id: line.variantId }, data: { costPricePaise: line.unitCostPaise } });
      }
      return bill;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new PurchaseError("This supplier's bill with that number is already recorded");
    throw error;
  }
}

/** Removes a bill entered by mistake and takes its quantities back out of stock. */
export async function deletePurchase(billId: string) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchaseBill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!bill) throw new PurchaseError("Bill not found");
    for (const line of bill.lines) {
      const updated = await tx.inventoryItem.updateMany({ where: { variantId: line.variantId, stockOnHand: { gte: line.quantity } }, data: { stockOnHand: { decrement: line.quantity } } });
      if (updated.count !== 1) throw new PurchaseError("Some of this bill's stock has already been sold, so it cannot be removed. Record a purchase return instead.");
    }
    await tx.purchaseBill.delete({ where: { id: billId } });
  });
}

export async function markPaid(billId: string, paidOn: string | null) {
  const bill = await prisma.purchaseBill.findUnique({ where: { id: billId } });
  if (!bill) throw new PurchaseError("Bill not found");
  if (paidOn && paidOn < bill.billDate.toISOString().slice(0, 10)) throw new PurchaseError("The bill cannot be paid before its date");
  return prisma.purchaseBill.update({ where: { id: billId }, data: { paidOn: paidOn ? new Date(`${paidOn}T00:00:00Z`) : null } });
}

/** Bill total including GST, in paise, as the books compute it (GST rounded per line). */
export const billTotalPaise = (lines: { quantity: number; unitCostPaise: number; gstPercent: number }[]) =>
  lines.reduce((sum, l) => {
    const taxable = l.quantity * l.unitCostPaise;
    return sum + taxable + Math.round((taxable * l.gstPercent) / 100);
  }, 0);
