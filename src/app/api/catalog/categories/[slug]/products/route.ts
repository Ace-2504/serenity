import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: { slug: string } }) {
  const category = await prisma.category.findUnique({
    where: { slug: params.slug },
    select: { id: true, name: true, slug: true }
  });

  if (!category) {
    return NextResponse.json({ message: "Category not found" }, { status: 404 });
  }

  const items = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: {
        status: "published",
        categoryId: category.id
      }
    },
    include: {
      product: {
        select: {
          title: true,
          slug: true,
          description: true
        }
      }
    },
    orderBy: { priceInr: "asc" }
  });

  return NextResponse.json({
    category,
    items: items.map((item) => ({
      id: item.id,
      sku: item.sku,
      productTitle: item.product.title,
      productSlug: item.product.slug,
      description: item.product.description,
      priceInr: item.priceInr,
      compareAtPriceInr: item.compareAtPriceInr
    }))
  });
}