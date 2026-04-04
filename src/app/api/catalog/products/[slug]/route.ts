import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  const product = await prisma.product.findUnique({
    where: { slug: params.slug },
    include: {
      category: { select: { name: true, slug: true } },
      brand: { select: { name: true } },
      variants: {
        where: { isActive: true },
        include: { inventory: true },
        orderBy: { priceInr: "asc" }
      }
    }
  });

  if (!product || product.status !== "published") {
    return NextResponse.json({ message: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: product.id,
    title: product.title,
    slug: product.slug,
    description: product.description,
    brand: product.brand,
    category: product.category,
    gstPercent: product.gstPercent,
    hsnCode: product.hsnCode,
    isInvoiceEligible: product.isInvoiceEligible,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      priceInr: variant.priceInr,
      compareAtPriceInr: variant.compareAtPriceInr,
      stockOnHand: variant.inventory?.stockOnHand ?? 0,
      attributes: variant.attributesJson
    }))
  });
}