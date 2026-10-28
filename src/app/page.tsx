import Link from "next/link";
import Image from "next/image";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AddToCartButton from "@/components/add-to-cart-button";
import { getProductImage } from "../lib/product-images";

export const dynamic = "force-dynamic";

const CATEGORY_ACCENTS: Record<string, { bg: string; ring: string; tag: string }> = {
  "notebooks-and-journals": { bg: "bg-[#eaf3f4]", ring: "ring-[#9fbfc3]", tag: "Most Loved" },
  "pens-and-writing": { bg: "bg-[#e5f0ee]", ring: "ring-[#8db2a8]", tag: "Daily Pick" },
  "art-supplies": { bg: "bg-[#f2ece9]", ring: "ring-[#c3a191]", tag: "Creator Choice" },
  "desk-accessories": { bg: "bg-[#e7eef4]", ring: "ring-[#97acc0]", tag: "Workspace Pro" },
  "planners-and-diaries": { bg: "bg-[#eaf0f2]", ring: "ring-[#9eb3bc]", tag: "Plan Better" },
  default: { bg: "bg-paper", ring: "ring-mist", tag: "Featured" }
};

const CATEGORY_DETAILS: Record<string, { blurb: string; cta: string }> = {
  "notebooks-and-journals": {
    blurb: "High-GSM pages with smooth finishes for notes, journaling, and planning.",
    cta: "Shop notebooks"
  },
  "pens-and-writing": {
    blurb: "Ball, gel, brush, and fineliner pens tested for comfort and precision.",
    cta: "Shop pens and markers"
  },
  "art-supplies": {
    blurb: "Creative essentials for sketching, coloring, lettering, and mixed-media.",
    cta: "Shop art"
  },
  "desk-accessories": {
    blurb: "Declutter your desk with practical organizers and utility essentials.",
    cta: "Shop desk"
  },
  "planners-and-diaries": {
    blurb: "Undated and structured planners to keep routines and goals on track.",
    cta: "Shop planners"
  },
  default: {
    blurb: "Everyday stationery picks curated for students and professionals.",
    cta: "Shop category"
  }
};

const CATEGORY_IMAGES: Record<string, { src: string; alt: string; position: string }> = {
  "notebooks-and-journals": {
    src: "/category-photos/notebooks.jpg",
    alt: "Notebook and journal category",
    position: "object-[center_55%]"
  },
  "pens-and-writing": {
    src: "/category-photos/pens.jpg",
    alt: "Pens and markers category",
    position: "object-[center_52%]"
  },
  "art-supplies": {
    src: "/category-photos/craft.jpg",
    alt: "Art supplies category",
    position: "object-[center_55%]"
  },
  "desk-accessories": {
    src: "/category-photos/desk.jpg",
    alt: "Desk accessories category",
    position: "object-[center_45%]"
  },
  "planners-and-diaries": {
    src: "/category-photos/planners.jpg",
    alt: "Planners and diaries category",
    position: "object-[center_52%]"
  },
  default: {
    src: "/category-photos/supplies.jpg",
    alt: "Stationery category",
    position: "object-center"
  }
};

async function getHomeData() {
  const [categories, featuredVariants] = await Promise.all([
    prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 8,
      select: { id: true, name: true, slug: true }
    }),
    prisma.productVariant.findMany({
      where: { isActive: true, product: { status: "published" } },
      orderBy: { priceInr: "desc" },
      take: 9,
      include: {
        product: { select: { title: true, slug: true, description: true, category: { select: { slug: true } } } },
        inventory: { select: { stockOnHand: true } }
      }
    })
  ]);

  return { categories, featuredVariants };
}

export default async function HomePage() {
  const session = getServerSession();
  const { categories, featuredVariants } = await getHomeData();
  const isAdmin = !!session?.roles?.some((role) =>
    ["owner_admin", "catalog_manager", "order_operations"].includes(role)
  );

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-20 md:px-8 xl:px-12">
      <div className="-mx-4 border-b border-forest/15 bg-ink px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-canvas md:-mx-8 md:px-8 xl:-mx-12 xl:px-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>Dispatch in 24 hours for in-stock orders</p>
          <p>Free shipping above Rs 499</p>
          <p>GST invoices available for business orders</p>
        </div>
      </div>

      <header className="sticky top-0 z-20 -mx-4 border-b border-mist/60 bg-canvas/95 px-4 backdrop-blur-xl md:-mx-8 md:px-8 xl:-mx-12 xl:px-12">
        <div className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-ink to-forest text-xs font-black text-canvas shadow-sm">
                P
              </span>
              <span className="leading-tight">
                <span className="block font-display text-lg leading-none text-ink">Paper Serenity</span>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-graphite/85">
                  Stationery Hub
                </span>
              </span>
            </Link>
            <span className="hidden rounded-full border border-forest/20 bg-forest/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-forest md:inline-flex">
              Weekend Offer Live
            </span>
          </div>

          <div className="flex items-center gap-2 text-sm font-medium">
            <Link href="/c/notebooks-and-journals" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
              Collections
            </Link>
            <Link href="/c/art-supplies" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
              Art and Crafts
            </Link>
            <Link href="/cart" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
              Cart
            </Link>
            {session ? (
              <>
                {isAdmin ? (
                  <Link href="/admin" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
                    Admin
                  </Link>
                ) : null}
                <Link href="/account" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
                  Account
                </Link>
                <form action="/api/auth/logout" method="post">
                  <input type="hidden" name="next" value="/" />
                  <button type="submit" className="rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink">
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink">
                  Sign in
                </Link>
                <Link href="/register" className="rounded-full bg-ink px-3 py-1.5 text-canvas hover:bg-terracotta">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <article className="relative overflow-hidden rounded-[2rem] border border-mist/70 bg-gradient-to-br from-[#ecf8fa] via-[#dceff3] to-[#cedfe7] p-8 shadow-panel md:p-12">
          <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-forest/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-20 left-20 h-64 w-64 rounded-full bg-sage/20 blur-3xl" />

          <p className="inline-flex items-center gap-2 rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-forest">
            Bestseller Drop
          </p>
          <h1 className="mt-4 max-w-2xl font-display text-4xl leading-tight text-ink md:text-6xl">
            Discover Stationery That Makes Everyday Work Feel Premium
          </h1>
          <p className="mt-4 max-w-xl text-base text-graphite md:text-lg">
            Explore top-rated notebooks, smooth writing tools, planning kits, and desk essentials curated for focused study and creative flow.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/bestsellers" className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-canvas hover:bg-forest">
              Shop Bestsellers
            </Link>
            <Link href="/c/pens-and-writing" className="rounded-full border border-ink bg-canvas/70 px-6 py-3 text-sm font-semibold text-ink hover:bg-canvas">
              Explore Pens and Markers
            </Link>
          </div>

          <div className="mt-8 grid gap-3 text-xs font-semibold text-graphite sm:grid-cols-3">
            <div className="rounded-xl border border-mist/80 bg-canvas/75 px-3 py-2">Rs 499+ free shipping</div>
            <div className="rounded-xl border border-mist/80 bg-canvas/75 px-3 py-2">Secure payments</div>
            <div className="rounded-xl border border-mist/80 bg-canvas/75 px-3 py-2">Easy 7-day returns</div>
          </div>
        </article>

        <aside className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          <article className="rounded-2xl border border-mist bg-[#fdf4ea] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-terracotta">Clearance Shelf</p>
            <p className="mt-2 text-3xl font-bold text-ink">Up to 45% Off</p>
            <p className="mt-1 text-sm text-graphite">Limited lots on planners, markers, and journaling kits.</p>
            <Link href="/clearance" className="mt-4 inline-flex text-sm font-semibold text-ink hover:underline">
              Grab deals -&gt;
            </Link>
          </article>

          <article className="rounded-2xl border border-mist bg-[#ebf4ef] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-forest">Bulk Orders</p>
            <p className="mt-2 text-xl font-semibold text-ink">For schools, teams, and offices</p>
            <p className="mt-1 text-sm text-graphite">Custom invoicing and volume pricing on high-quantity carts.</p>
            <Link href="/bulk-orders" className="mt-4 inline-flex text-sm font-semibold text-ink hover:underline">
              Request pricing -&gt;
            </Link>
          </article>

          <article className="rounded-2xl border border-mist bg-[#e9f0f5] p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#53718a]">New This Week</p>
            <p className="mt-2 text-xl font-semibold text-ink">Fresh desk accessories</p>
            <p className="mt-1 text-sm text-graphite">Functional organizers designed for clean, distraction-free setups.</p>
            <Link href="/c/desk-accessories" className="mt-4 inline-flex text-sm font-semibold text-ink hover:underline">
              View arrivals -&gt;
            </Link>
          </article>
        </aside>
      </section>

      <section className="mt-10 rounded-3xl border border-mist/70 bg-paper px-4 py-8 md:px-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl text-ink md:text-4xl">Browse By Category</h2>
            <p className="mt-1 text-sm text-graphite">Tap a collection to start shopping.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {categories.slice(0, 6).map((category) => {
          const image = CATEGORY_IMAGES[category.slug] ?? CATEGORY_IMAGES.default;

          return (
            <Link
              key={`category-${category.id}`}
              href={`/c/${category.slug}`}
              className="group flex flex-col items-center"
            >
              <div className="relative h-36 w-36 overflow-hidden rounded-full border border-mist/80 bg-canvas shadow-sm transition duration-300 group-hover:scale-105 group-hover:shadow-panel md:h-44 md:w-44">
                <Image
                  src={image.src}
                  alt={image.alt}
                  fill
                  sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 16vw"
                  className={`object-cover ${image.position} transition duration-500 group-hover:scale-105`}
                />
              </div>

              <h3 className="mt-3 text-center text-xl font-medium text-ink transition group-hover:text-forest">
                {category.name.replace(" & ", " ")}
              </h3>
            </Link>
          );
        })}
        </div>
      </section>

      <section className="mt-12">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-3xl text-ink md:text-4xl">Trending Picks</h2>
            <p className="mt-1 text-sm text-graphite">Top stationery products chosen by students, creators, and teams.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-graphite">
            <span className="rounded-full border border-mist bg-paper px-3 py-1">Fast Dispatch</span>
            <span className="rounded-full border border-mist bg-paper px-3 py-1">Best Value</span>
            <span className="rounded-full border border-mist bg-paper px-3 py-1">In Stock</span>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {featuredVariants.length === 0 ? (
            <article className="col-span-3 rounded-2xl border border-mist bg-canvas p-8 text-center">
              <p className="text-lg font-semibold">No featured products yet</p>
              <p className="mt-1 text-sm text-graphite">Add products from admin inventory to populate this section.</p>
            </article>
          ) : (
            featuredVariants.map((variant, index) => {
              const inStock = (variant.inventory?.stockOnHand ?? 0) > 0;
              const discountPct = variant.compareAtPriceInr
                ? Math.round((1 - variant.priceInr / variant.compareAtPriceInr) * 100)
                : null;
              const image = getProductImage({
                slug: variant.product.slug,
                sku: variant.sku,
                title: variant.product.title,
                categorySlug: variant.product.category.slug
              });

              return (
                <article
                  key={variant.id}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl border border-mist bg-canvas shadow-sm transition hover:-translate-y-1 hover:shadow-panel ${
                    !inStock ? "grayscale opacity-70" : ""
                  }`}
                >
                  <Link
                    href={`/p/${variant.product.slug}`}
                    aria-label={`View ${variant.product.title}`}
                    className="absolute inset-0 z-10"
                  />
                  <div className="relative h-52 overflow-hidden border-b border-mist/70 bg-gradient-to-br from-paper via-[#e7f1f4] to-[#d7e6ee]">
                    <Image
                      src={image.src}
                      alt={image.alt}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className={`object-contain p-3 ${image.position} transition duration-500 group-hover:scale-105`}
                    />
                    <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-canvas/70" />
                    <div className="absolute -bottom-10 -left-10 h-24 w-24 rounded-full bg-sage/20" />
                    <span className="absolute left-3 top-3 rounded-full bg-mustard px-2.5 py-0.5 text-xs font-semibold text-ink">
                      #{index + 1} Trend
                    </span>
                    {discountPct ? (
                      <span className="absolute right-3 top-3 rounded-full bg-terracotta px-2.5 py-0.5 text-xs font-bold text-canvas">
                        {discountPct}% off
                      </span>
                    ) : null}
                    {!inStock ? (
                      <span className="absolute bottom-3 right-3 rounded-full bg-graphite/85 px-2.5 py-0.5 text-xs font-semibold text-canvas">
                        Out of stock
                      </span>
                    ) : null}
                  </div>

                  <div className="relative z-20 flex flex-1 flex-col p-5">
                    <h3 className="text-lg font-semibold leading-snug text-ink">
                      <span className="group-hover:text-terracotta">{variant.product.title}</span>
                    </h3>
                    <p className="mt-2 line-clamp-2 text-sm text-graphite">
                      {(variant.product.description ?? "Everyday stationery essential.").slice(0, 120)}
                    </p>

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
                          className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold text-ink hover:border-forest hover:bg-forest hover:text-canvas"
                        >
                          Quick View
                        </Link>
                        <AddToCartButton variantId={variant.id} disabled={!inStock} />
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="mt-12 rounded-2xl border border-mist bg-gradient-to-r from-canvas via-[#eff7f8] to-paper p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3">
            <p className="text-2xl font-bold text-ink">24h</p>
            <p className="text-sm text-graphite">Dispatch on ready inventory</p>
          </div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3">
            <p className="text-2xl font-bold text-ink">50K+</p>
            <p className="text-sm text-graphite">Orders fulfilled nationwide</p>
          </div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3">
            <p className="text-2xl font-bold text-ink">98%</p>
            <p className="text-sm text-graphite">Packing accuracy benchmark</p>
          </div>
          <div className="rounded-xl border border-mist/70 bg-canvas/70 px-4 py-3">
            <p className="text-2xl font-bold text-ink">4.8/5</p>
            <p className="text-sm text-graphite">Average verified ratings</p>
          </div>
        </div>
      </section>

      <footer className="mt-14 border-t border-mist pt-8 text-sm text-graphite">
        <div className="grid gap-6 md:grid-cols-[1fr_auto_auto] md:items-center">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-xs font-black text-canvas">P</span>
            <span className="font-display text-base text-ink">Paper Serenity Stationery Hub</span>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <Link href="/c/notebooks-and-journals" className="hover:text-ink">Notebooks</Link>
            <Link href="/c/pens-and-writing" className="hover:text-ink">Pens and Markers</Link>
            <Link href="/c/art-supplies" className="hover:text-ink">Art</Link>
            <Link href="/cart" className="hover:text-ink">Cart</Link>
            <Link href="/account/orders" className="hover:text-ink">Orders</Link>
          </div>

          <div className="text-xs text-graphite md:text-right">
            <p>Copyright {new Date().getFullYear()} Paper Serenity Stationery Hub. All rights reserved.</p>
            <p className="mt-2">
              <a
                href="https://github.com/Ace-2504"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-ink"
              >
                Developed by HarmanTechnologies
              </a>
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
