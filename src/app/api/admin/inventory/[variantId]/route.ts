import { NextRequest, NextResponse } from "next/server";
import { ProductStatus } from "@prisma/client";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? ""), 10);
}

export async function PATCH(request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: {
      inventory: true,
      product: true
    }
  });

  if (!existing) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  const nextSku = String(body.sku ?? "").trim().toUpperCase();

  const title = String(body.title ?? existing.product.title).trim();
  const description = String(body.description ?? existing.product.description).trim();
  const hsnCode = String(body.hsnCode ?? existing.product.hsnCode).trim();
  const gstPercent = toInt(body.gstPercent ?? existing.product.gstPercent);
  const status = String(body.status ?? existing.product.status).trim().toLowerCase() as ProductStatus;
  const categoryId = String(body.categoryId ?? existing.product.categoryId).trim();
  const brandId = String(body.brandId ?? existing.product.brandId).trim();
  const priceInr = toInt(body.priceInr ?? existing.priceInr);

  const compareAtPriceInr = Object.prototype.hasOwnProperty.call(body, "compareAtPriceInr")
    ? (body.compareAtPriceInr === null || String(body.compareAtPriceInr ?? "").trim() === ""
        ? null
        : toInt(body.compareAtPriceInr))
    : existing.compareAtPriceInr;

  const stockOnHand = toInt(body.stockOnHand ?? existing.inventory?.stockOnHand ?? 0);
  const lowStockThreshold = toInt(body.lowStockThreshold ?? existing.inventory?.lowStockThreshold ?? 0);

  if (
    Number.isNaN(priceInr) ||
    Number.isNaN(gstPercent) ||
    Number.isNaN(stockOnHand) ||
    Number.isNaN(lowStockThreshold) ||
    priceInr <= 0 ||
    stockOnHand < 0 ||
    lowStockThreshold < 0 ||
    gstPercent < 0 ||
    gstPercent > 50 ||
    !title ||
    !description ||
    !hsnCode ||
    !categoryId ||
    !brandId
  ) {
    return NextResponse.json({ message: "Invalid product, pricing, tax, or stock values." }, { status: 400 });
  }

  if (compareAtPriceInr !== null && (Number.isNaN(compareAtPriceInr) || compareAtPriceInr < priceInr)) {
    return NextResponse.json({ message: "Compare-at price must be greater than or equal to selling price." }, { status: 400 });
  }

  if (!["draft", "published", "archived"].includes(status)) {
    return NextResponse.json({ message: "Invalid product status." }, { status: 400 });
  }

  const [category, brand] = await Promise.all([
    prisma.category.findUnique({ where: { id: categoryId } }),
    prisma.brand.findUnique({ where: { id: brandId } })
  ]);

  if (!category) {
    return NextResponse.json({ message: "Selected category does not exist." }, { status: 404 });
  }

  if (!brand) {
    return NextResponse.json({ message: "Selected brand does not exist." }, { status: 404 });
  }

  if (nextSku && nextSku !== existing.sku) {
    const skuTaken = await prisma.productVariant.findUnique({ where: { sku: nextSku } });
    if (skuTaken) {
      return NextResponse.json({ message: "SKU already exists." }, { status: 409 });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.update({
      where: { id: variantId },
      data: {
        sku: nextSku || existing.sku,
        priceInr,
        compareAtPriceInr
      }
    });

    await tx.product.update({
      where: { id: existing.productId },
      data: {
        title,
        description,
        hsnCode,
        gstPercent,
        status,
        categoryId,
        brandId
      }
    });

    const inventory = existing.inventory
      ? await tx.inventoryItem.update({
          where: { variantId },
          data: {
            stockOnHand,
            lowStockThreshold
          }
        })
      : await tx.inventoryItem.create({
          data: {
            variantId,
            stockOnHand,
            lowStockThreshold
          }
        });

    return { variant, inventory };
  });

  return NextResponse.json({
    message: "Inventory updated.",
    item: {
      variantId,
      sku: updated.variant.sku,
      priceInr: updated.variant.priceInr,
      compareAtPriceInr: updated.variant.compareAtPriceInr,
      stockOnHand: updated.inventory.stockOnHand,
      lowStockThreshold: updated.inventory.lowStockThreshold
    }
  });
}

export async function DELETE(_request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(_request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const existing = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true, product: true }
  });

  if (!existing) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { isActive: false }
    });

    await tx.product.update({
      where: { id: existing.productId },
      data: { status: "archived" }
    });

    if (existing.inventory) {
      await tx.inventoryItem.update({
        where: { variantId },
        data: { stockOnHand: 0 }
      });
    }
  });

  return NextResponse.json({
    message: "Product removed from stock.",
    item: {
      variantId,
      productId: existing.productId,
      productTitle: existing.product.title
    }
  });
}
