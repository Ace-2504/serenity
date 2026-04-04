import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import AddToCartButton from "@/components/add-to-cart-button";
import { getProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

async function getBestsellersByCategory() {
  const [categories, soldRows] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true }
    }),
    prisma.orderItem.groupBy({
      by: ["variantId"],
      _sum: { quantity: true }
    })
  ]);

  const soldByVariant = new Map<string, number>();
  soldRows.forEach((row) => soldByVariant.set(row.variantId, row._sum.quantity ?? 0));

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: {
        status: "published",
        category: { isActive: true }
      }
    },
    include: {
      inventory: { select: { stockOnHand: true } },
      product: {
        select: {
          title: true,
          slug: true,
          categoryId: true,
          category: { select: { name: true, slug: true } }
        }
      }
    }
  });

  const bestByCategory = new Map<string, (typeof variants)[number]>();

  for (const variant of variants) {
    const categoryId = variant.product.categoryId;
    const current = bestByCategory.get(categoryId);

    if (!current) {
      bestByCategory.set(categoryId, variant);
      continue;
    }

    const currentSold = soldByVariant.get(current.id) ?? 0;
    const nextSold = soldByVariant.get(variant.id) ?? 0;

    if (nextSold > currentSold) {
      bestByCategory.set(categoryId, variant);
      continue;
    }

    if (nextSold === currentSold) {
      const currentStock = current.inventory?.stockOnHand ?? 0;
      const nextStock = variant.inventory?.stockOnHand ?? 0;
      if (nextStock > currentStock) {
        bestByCategory.set(categoryId, variant);
      }
    }
  }

  return categories
    .map((category) => ({ category, variant: bestByCategory.get(category.id) }))
    .filter((item): item is { category: (typeof categories)[number]; variant: (typeof variants)[number] } => !!item.variant);
}

export default async function BestsellersPage() {
  const rows = await getBestsellersByCategory();

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-20 pt-8 md:px-8 xl:px-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-forest">Bestsellers</p>
        <h1 className="font-display text-4xl text-ink">Top Pick From Each Category</h1>
        <p className="mt-2 max-w-3xl text-sm text-graphite">These products are selected as category bestsellers based on sales history, with stock strength as tie-breaker.</p>
      </header>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ category, variant }) => {
          const inStock = (variant.inventory?.stockOnHand ?? 0) > 0;
          const image = getProductImage({
            slug: variant.product.slug,
            sku: variant.sku,
            title: variant.product.title,
            categorySlug: variant.product.category.slug
          });
          const discountPct = variant.compareAtPriceInr ? Math.round((1 - variant.priceInr / variant.compareAtPriceInr) * 100) : null;

          return (
            <article
              key={variant.id}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border border-mist bg-canvas shadow-sm transition hover:-translate-y-1 hover:shadow-panel ${
                !inStock ? "grayscale opacity-70" : ""
              }`}
            >
              <div className="relative h-52 overflow-hidden border-b border-mist/70 bg-gradient-to-br from-paper via-[#e7f1f4] to-[#d7e6ee]">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                  className={`object-contain p-3 ${image.position}`}
                />
                <span className="absolute left-3 top-3 rounded-full bg-ink px-2.5 py-0.5 text-xs font-semibold text-canvas">{category.name}</span>
                {discountPct ? <span className="absolute right-3 top-3 rounded-full bg-terracotta px-2.5 py-0.5 text-xs font-bold text-canvas">{discountPct}% off</span> : null}
                {!inStock ? <span className="absolute right-3 bottom-3 rounded-full bg-graphite/85 px-2.5 py-0.5 text-xs font-semibold text-canvas">Out of stock</span> : null}
              </div>

              <div className="flex flex-1 flex-col p-5">
                <h2 className="text-lg font-semibold text-ink">{variant.product.title}</h2>
                <p className="mt-3 text-2xl font-bold text-ink">Rs {variant.priceInr}</p>
                {variant.compareAtPriceInr ? <p className="text-sm text-graphite line-through">Rs {variant.compareAtPriceInr}</p> : null}
                <div className="mt-4 flex items-center gap-2">
                  <Link href={`/p/${variant.product.slug}`} className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold text-ink hover:border-forest hover:bg-forest hover:text-canvas">
                    View Product
                  </Link>
                  <AddToCartButton variantId={variant.id} disabled={!inStock} />
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
