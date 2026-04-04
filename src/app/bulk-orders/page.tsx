import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/prisma";
import { getProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

async function getBulkSuggestions() {
  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: {
        status: "published",
        category: { isActive: true }
      },
      inventory: { stockOnHand: { gte: 30 } }
    },
    orderBy: { priceInr: "asc" },
    include: {
      inventory: { select: { stockOnHand: true } },
      product: { select: { title: true, slug: true, category: { select: { slug: true, name: true } } } }
    },
    take: 60
  });

  const schoolSlugs = new Set(["notebooks-and-journals", "pens-and-writing", "art-supplies"]);
  const officeSlugs = new Set(["desk-accessories", "pens-and-writing", "notebooks-and-journals"]);

  const school = variants.filter((v) => schoolSlugs.has(v.product.category.slug)).slice(0, 8);
  const office = variants.filter((v) => officeSlugs.has(v.product.category.slug)).slice(0, 8);

  return { school, office };
}

function SuggestionGrid({ title, items }: { title: string; items: Awaited<ReturnType<typeof getBulkSuggestions>>["school"] }) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold text-ink">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {items.map((variant) => {
          const image = getProductImage({
            slug: variant.product.slug,
            sku: variant.sku,
            title: variant.product.title,
            categorySlug: variant.product.category.slug
          });

          return (
            <article key={variant.id} className="overflow-hidden rounded-2xl border border-mist bg-canvas shadow-sm">
              <div className="relative h-44 border-b border-mist/70 bg-gradient-to-br from-paper via-[#e7f1f4] to-[#d7e6ee]">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 25vw"
                  className={`object-contain p-3 ${image.position}`}
                />
              </div>
              <div className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-graphite">{variant.product.category.name}</p>
                <h3 className="mt-1 text-sm font-semibold text-ink">{variant.product.title}</h3>
                <p className="mt-2 text-lg font-bold text-ink">Rs {variant.priceInr}</p>
                <p className="text-xs text-graphite">Bulk-ready stock: {variant.inventory?.stockOnHand ?? 0}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default async function BulkOrdersPage() {
  const { school, office } = await getBulkSuggestions();

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-20 pt-8 md:px-8 xl:px-12">
      <header className="mb-8 rounded-2xl border border-mist bg-gradient-to-br from-[#ebf4ef] via-[#e2f2e9] to-[#d2e8dd] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-forest">Bulk Orders</p>
        <h1 className="font-display text-4xl text-ink">Suggested Supplies for Schools and Offices</h1>
        <p className="mt-2 max-w-3xl text-sm text-graphite">Curated high-stock products commonly ordered in larger quantities.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/checkout" className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest">
            Start Bulk Checkout
          </Link>
          <Link href="/account/orders" className="rounded-full border border-ink px-5 py-2 text-sm font-semibold text-ink hover:bg-paper">
            View Order History
          </Link>
        </div>
      </header>

      <div className="space-y-10">
        <SuggestionGrid title="Recommended for Schools" items={school} />
        <SuggestionGrid title="Recommended for Offices" items={office} />
      </div>
    </main>
  );
}
