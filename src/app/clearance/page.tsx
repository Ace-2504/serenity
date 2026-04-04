import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import AddToCartButton from "@/components/add-to-cart-button";
import { getProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

async function getClearanceItems() {
  const rows = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      compareAtPriceInr: { not: null },
      product: { status: "published" }
    },
    include: {
      product: { select: { title: true, slug: true, category: { select: { slug: true, name: true } } } },
      inventory: { select: { stockOnHand: true } }
    },
    take: 30
  });

  return rows
    .filter((item) => !!item.compareAtPriceInr && item.compareAtPriceInr > item.priceInr)
    .sort((a, b) => {
      const aPct = Math.round((1 - a.priceInr / (a.compareAtPriceInr as number)) * 100);
      const bPct = Math.round((1 - b.priceInr / (b.compareAtPriceInr as number)) * 100);
      return bPct - aPct;
    })
    .slice(0, 18);
}

export default async function ClearancePage() {
  const items = await getClearanceItems();

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-20 pt-8 md:px-8 xl:px-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-terracotta">Clearance Shelf</p>
        <h1 className="font-display text-4xl text-ink">Limited Deals and Deep Discounts</h1>
        <p className="mt-2 max-w-3xl text-sm text-graphite">Grab high-value stationery bundles before stock runs out.</p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-mist bg-paper p-8 text-center">
          <p className="text-lg font-semibold text-ink">No clearance items available right now.</p>
          <p className="mt-2 text-sm text-graphite">Please check back later for new markdowns.</p>
        </section>
      ) : (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((variant) => {
            const inStock = (variant.inventory?.stockOnHand ?? 0) > 0;
            const image = getProductImage({
              slug: variant.product.slug,
              sku: variant.sku,
              title: variant.product.title,
              categorySlug: variant.product.category.slug
            });
            const discountPct = Math.round((1 - variant.priceInr / (variant.compareAtPriceInr as number)) * 100);

            return (
              <article
                key={variant.id}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-mist bg-canvas shadow-sm transition hover:-translate-y-1 hover:shadow-panel ${
                  !inStock ? "grayscale opacity-70" : ""
                }`}
              >
                <div className="relative h-52 overflow-hidden border-b border-mist/70 bg-gradient-to-br from-[#fff4ea] via-[#ffe8d8] to-[#ffd8bf]">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                    className={`object-contain p-3 ${image.position}`}
                  />
                  <span className="absolute left-3 top-3 rounded-full bg-terracotta px-2.5 py-0.5 text-xs font-semibold text-canvas">{discountPct}% off</span>
                  <span className="absolute right-3 top-3 rounded-full bg-canvas px-2.5 py-0.5 text-xs font-semibold text-ink">{variant.product.category.name}</span>
                  {!inStock ? <span className="absolute right-3 bottom-3 rounded-full bg-graphite/85 px-2.5 py-0.5 text-xs font-semibold text-canvas">Out of stock</span> : null}
                </div>

                <div className="flex flex-1 flex-col p-5">
                  <h2 className="text-lg font-semibold text-ink">{variant.product.title}</h2>
                  <div className="mt-2 flex items-end gap-2">
                    <p className="text-2xl font-bold text-ink">Rs {variant.priceInr}</p>
                    <p className="mb-0.5 text-sm text-graphite line-through">Rs {variant.compareAtPriceInr}</p>
                  </div>
                  <p className="mt-1 text-xs text-graphite">Stock: {variant.inventory?.stockOnHand ?? 0}</p>
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
      )}
    </main>
  );
}
