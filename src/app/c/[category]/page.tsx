import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import AddToCartButton from "@/components/add-to-cart-button";
import { prisma } from "@/lib/prisma";
import { getProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: { category: string } }) {
  const category = await prisma.category.findFirst({
    where: { slug: params.category, isActive: true },
    select: { id: true, name: true, slug: true }
  });

  if (!category) {
    notFound();
  }

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: { categoryId: category.id, status: "published" }
    },
    include: {
      product: { select: { title: true, slug: true, description: true } },
      inventory: { select: { stockOnHand: true } }
    },
    orderBy: { priceInr: "asc" }
  });

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-16 pt-6 md:px-8 xl:px-12">
      <header className="mb-8 rounded-3xl border border-mist/70 bg-gradient-to-br from-[#edf8f9] via-[#e2f0f3] to-[#d6e5ec] p-6 md:p-8">
        <p className="inline-flex rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-forest">
          Category Collection
        </p>
        <h1 className="mt-3 font-display text-4xl text-ink md:text-5xl">{category.name}</h1>
        <p className="mt-2 text-sm text-graphite md:text-base">
          {variants.length} {variants.length === 1 ? "product" : "products"} currently available in this shelf.
        </p>
      </header>

      {variants.length === 0 ? (
        <section className="rounded-2xl border border-mist bg-canvas p-10 text-center">
          <p className="text-xl font-semibold">No products in this category yet.</p>
          <p className="mt-2 text-sm text-graphite">Add products from the admin inventory to populate this page.</p>
          <Link href="/" className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas">
            Back to Home
          </Link>
        </section>
      ) : (
        <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {variants.map((variant, index) => {
            const inStock = (variant.inventory?.stockOnHand ?? 0) > 0;
            const discountPct = variant.compareAtPriceInr
              ? Math.round((1 - variant.priceInr / variant.compareAtPriceInr) * 100)
              : null;
            const image = getProductImage({
              slug: variant.product.slug,
              sku: variant.sku,
              title: variant.product.title,
              categorySlug: category.slug
            });

            return (
              <article
                key={variant.id}
                className={`group relative flex flex-col overflow-hidden rounded-2xl border border-mist bg-canvas shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel ${
                  !inStock ? "grayscale opacity-70" : ""
                }`}
              >
                <Link
                  href={`/p/${variant.product.slug}`}
                  aria-label={`View ${variant.product.title}`}
                  className="absolute inset-0 z-10"
                />
                {/* image placeholder */}
                <div className="relative h-44 bg-gradient-to-br from-paper via-[#e7f0f2] to-mist/35">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                    className={`object-contain p-3 ${image.position} transition duration-500 group-hover:scale-105`}
                  />
                  <span className="absolute left-3 bottom-3 rounded-full border border-mist/80 bg-canvas px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-graphite">
                    #{index + 1} in {category.name}
                  </span>
                  {discountPct ? (
                    <span className="absolute left-3 top-3 rounded-full bg-terracotta px-2.5 py-0.5 text-xs font-bold text-canvas">
                      {discountPct}% off
                    </span>
                  ) : null}
                  {!inStock ? (
                    <span className="absolute right-3 top-3 rounded-full bg-graphite/70 px-2.5 py-0.5 text-xs text-canvas">
                      Out of stock
                    </span>
                  ) : null}
                </div>

                <div className="relative z-20 flex flex-1 flex-col p-5">
                  <h2 className="text-lg font-semibold leading-snug text-ink">
                    <span className="group-hover:text-terracotta">{variant.product.title}</span>
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-graphite">{variant.product.description}</p>

                  <div className="mt-auto pt-4">
                    <div className="mb-3 flex items-end gap-2">
                      <p className="text-2xl font-bold text-ink">Rs {variant.priceInr}</p>
                      {variant.compareAtPriceInr ? (
                        <p className="mb-0.5 text-sm text-graphite line-through">Rs {variant.compareAtPriceInr}</p>
                      ) : null}
                    </div>
                    <div className="relative z-20 flex items-center gap-2">
                      <Link
                        href={`/p/${variant.product.slug}`}
                        className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold hover:bg-forest hover:border-forest hover:text-canvas"
                      >
                        Details
                      </Link>
                      <AddToCartButton variantId={variant.id} disabled={!inStock} />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <section className="mt-10 rounded-2xl border border-mist bg-gradient-to-r from-canvas via-[#eff7f8] to-paper p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">
            Fast dispatch for in-stock products
          </div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">
            Secure checkout and GST-friendly invoices
          </div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">
            Easy returns for damaged shipments
          </div>
        </div>
      </section>
    </main>
  );
}