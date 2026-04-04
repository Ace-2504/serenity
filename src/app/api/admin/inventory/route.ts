import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { createInventoryItem, InventoryValidationError, normalizeStatus } from "@/lib/admin-inventory";
import { isCloudinaryUrl } from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? ""), 10);
}

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variants = await prisma.productVariant.findMany({
    orderBy: { product: { updatedAt: "desc" } },
    take: 20,
    include: {
      product: {
        include: {
          category: { select: { name: true } },
          brand: { select: { name: true } }
        }
      },
      inventory: true
    }
  });

  const items = variants.map((variant) => ({
    id: variant.id,
    productId: variant.productId,
    productSlug: variant.product.slug,
    sku: variant.sku,
    priceInr: variant.priceInr,
    compareAtPriceInr: variant.compareAtPriceInr,
    productTitle: variant.product.title,
    productDescription: variant.product.description,
    productStatus: variant.product.status,
    categoryId: variant.product.categoryId,
    categoryName: variant.product.category.name,
    brandId: variant.product.brandId,
    brandName: variant.product.brand.name,
    hsnCode: variant.product.hsnCode,
    gstPercent: variant.product.gstPercent,
    stockOnHand: variant.inventory?.stockOnHand ?? 0,
    lowStockThreshold: variant.inventory?.lowStockThreshold ?? 0,
    isActive: variant.isActive,
    gallery:
      Array.isArray((variant.attributesJson as Record<string, unknown> | null)?.gallery)
        ? ((variant.attributesJson as Record<string, unknown>).gallery as unknown[])
            .filter((item): item is string => typeof item === "string" && (item.startsWith("/") || isCloudinaryUrl(item)))
            .slice(0, 10)
        : [],
    updatedAt: variant.product.updatedAt
  }));

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  const title = String(body.title ?? "").trim();
  const description = String(body.description ?? "").trim();
  const hsnCode = String(body.hsnCode ?? "").trim();
  const gstPercent = toInt(body.gstPercent);
  const sku = String(body.sku ?? "").trim().toUpperCase();
  const priceInr = toInt(body.priceInr);
  const compareAtPriceInr = body.compareAtPriceInr ? toInt(body.compareAtPriceInr) : null;
  const stockOnHand = toInt(body.stockOnHand);
  const lowStockThreshold = body.lowStockThreshold ? toInt(body.lowStockThreshold) : 8;
  const categoryId = String(body.categoryId ?? "").trim();
  const brandId = String(body.brandId ?? "").trim();
  const status = normalizeStatus(body.status);

  try {
    const created = await prisma.$transaction(async (tx) =>
      createInventoryItem(tx, {
        title,
        description,
        hsnCode,
        gstPercent,
        sku,
        priceInr,
        compareAtPriceInr,
        stockOnHand,
        lowStockThreshold,
        status,
        categoryId,
        brandId,
        newCategoryName: String(body.newCategoryName ?? "").trim(),
        newBrandName: String(body.newBrandName ?? "").trim()
      })
    );

    return NextResponse.json(
      {
        message: "Inventory item created successfully.",
        item: {
          productId: created.product.id,
          productTitle: created.product.title,
          productSlug: created.product.slug,
          variantId: created.variant.id,
          sku: created.variant.sku,
          stockOnHand: created.inventory.stockOnHand
        }
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof InventoryValidationError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }

    return NextResponse.json({ message: "Unable to create inventory item." }, { status: 500 });
  }
}
