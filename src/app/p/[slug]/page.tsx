import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import AddToCartButton from "@/components/add-to-cart-button";
import { prisma } from "@/lib/prisma";
import { getProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: { slug: string } }) {
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
    notFound();
  }

  const primary = product.variants[0];
  if (!primary) {
    notFound();
  }

  const inStock = (primary.inventory?.stockOnHand ?? 0) > 0;
  const discountPct =
    primary.compareAtPriceInr
      ? Math.round((1 - primary.priceInr / primary.compareAtPriceInr) * 100)
      : null;
  const image = getProductImage({
    slug: product.slug,
    sku: primary.sku,
    title: product.title,
    categorySlug: product.category.slug
  });

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-16 pt-6 md:px-8 xl:px-12">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-1.5 text-sm text-graphite">
        <Link href="/" className="hover:text-ink">Home</Link>
        <span className="text-mist">/</span>
        <Link href={`/c/${product.category.slug}`} className="hover:text-ink">{product.category.name}</Link>
        <span className="text-mist">/</span>
        <span className="text-ink font-medium">{product.title}</span>
      </nav>

      <section className="grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        {/* Image area */}
        <div className="overflow-hidden rounded-2xl border border-mist bg-gradient-to-br from-paper via-[#e8f1f3] to-mist/35 shadow-sm">
          <div className="relative flex h-80 items-center justify-center md:h-[30rem]">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              sizes="(max-width: 1024px) 100vw, 55vw"
              className={`object-contain p-6 ${image.position}`}
            />
            {discountPct ? (
              <span className="absolute left-4 top-4 rounded-full bg-terracotta px-3 py-1 text-xs font-bold text-canvas">
                {discountPct}% OFF
              </span>
            ) : null}
            {!inStock ? (
              <span className="absolute right-4 top-4 rounded-full bg-graphite px-3 py-1 text-xs font-semibold text-canvas">
                Out of stock
              </span>
            ) : null}
          </div>
        </div>

        {/* Info panel */}
        <div className="flex flex-col">
          <p className="inline-flex w-fit rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-forest">
            {product.brand.name}
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink md:text-5xl">{product.title}</h1>
          <p className="mt-3 leading-relaxed text-graphite">{product.description}</p>

          {/* Pricing */}
          <div className="mt-6 rounded-2xl border border-mist bg-paper p-6 shadow-sm">
            <div className="flex items-end gap-3">
              <p className="font-display text-4xl font-bold text-ink">Rs {primary.priceInr}</p>
              {primary.compareAtPriceInr ? (
                <>
                  <p className="mb-1 text-base text-graphite line-through">Rs {primary.compareAtPriceInr}</p>
                  <span className="mb-1 rounded-full bg-sage/20 px-2.5 py-0.5 text-sm font-semibold text-forest">
                    {discountPct}% off
                  </span>
                </>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-graphite">
              Inclusive of {product.gstPercent}% GST &nbsp;·&nbsp; SKU: {primary.sku}
            </p>
            <p className={`mt-1.5 text-xs font-semibold ${ inStock ? "text-forest" : "text-terracotta" }`}>
              {inStock ? `✓ In stock (${primary.inventory?.stockOnHand} left)` : "Currently out of stock"}
            </p>

            <div className="mt-5 space-y-2">
              <AddToCartButton variantId={primary.id} disabled={!inStock} />
              <Link
                href="/checkout"
                className={`flex items-center justify-center rounded-full border border-ink px-4 py-2.5 text-sm font-semibold ${
                  inStock ? "hover:bg-forest hover:border-forest hover:text-canvas" : "pointer-events-none opacity-60"
                }`}
              >
                Buy Now
              </Link>
            </div>
          </div>

          {/* Trust tags */}
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-2">
            {[
              { icon: "GST", label: "GST invoice available" },
              { icon: "RET", label: "Easy returns" },
              { icon: "HSN", label: `${product.hsnCode}` },
              { icon: "INV", label: product.isInvoiceEligible ? "Invoice eligible" : "No invoice" }
            ].map((tag) => (
              <div key={tag.label} className="flex items-center gap-2 rounded-xl border border-mist bg-canvas px-3 py-2 text-xs text-graphite">
                <span className="rounded-md bg-paper px-1.5 py-1 text-[10px] font-semibold text-graphite/80">{tag.icon}</span>
                {tag.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-mist bg-gradient-to-r from-canvas via-[#eef6f8] to-paper p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">Packed with protective layering for safer transit</div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">Customer support available for order and invoice issues</div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3 text-sm text-graphite">Business purchases supported via invoice-ready checkout</div>
        </div>
      </section>
    </main>
  );
}