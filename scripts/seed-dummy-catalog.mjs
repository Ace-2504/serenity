import { PrismaClient } from "@prisma/client";

    name: "Art and Crafts",

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueProductSlug(base) {
  let index = 0;
  while (true) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const existing = await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    index += 1;
  }
}

const categorySeed = [
  {
    name: "Notebooks & Journals",
    slug: "notebooks-and-journals",
    items: [
      { title: "Classic Ruled Notebook A5", description: "Everyday ruled notebook for neat class and office notes.", priceInr: 129, compareAtPriceInr: 169, stockOnHand: 90 },
      { title: "Dotted Bullet Journal A5", description: "Dot-grid journal for planning, tracking, and creative layouts.", priceInr: 249, compareAtPriceInr: 299, stockOnHand: 75 },
      { title: "Hardbound Daily Journal", description: "Premium hardbound journal with smooth pages for daily writing.", priceInr: 349, compareAtPriceInr: 399, stockOnHand: 60 }
    ]
  },
  {
    name: "Pens and Markers",
    slug: "pens-and-writing",
    items: [
      { title: "Smooth Gel Pen Set", description: "Pack of smooth gel pens for dark, clean writing.", priceInr: 199, compareAtPriceInr: 249, stockOnHand: 120 },
      { title: "Fine Liner Marker Pack", description: "Fine markers for headings, underlines, and color coding.", priceInr: 229, compareAtPriceInr: 279, stockOnHand: 100 },
      { title: "Ball Pen Everyday Pack", description: "Reliable ball pens for exams, meetings, and daily use.", priceInr: 149, compareAtPriceInr: 189, stockOnHand: 140 }
    ]
  },
  {
    name: "Art Supplies",
    slug: "art-supplies",
    items: [
      { title: "Sketch Pencil Starter Set", description: "Graphite sketch pencils with blending tools for beginners.", priceInr: 299, compareAtPriceInr: 349, stockOnHand: 55 },
      { title: "A4 Artist Sketchbook", description: "Thick paper sketchbook suited for pencils and light markers.", priceInr: 329, compareAtPriceInr: 389, stockOnHand: 50 },
      { title: "Watercolor Brush Pen Set", description: "Flexible brush pens for watercolor-style lettering and art.", priceInr: 459, compareAtPriceInr: 529, stockOnHand: 35 }
    ]
  },
  {
    name: "Desk Accessories",
    slug: "desk-accessories",
    items: [
      { title: "Minimal Desk Organizer", description: "Simple organizer for pens, clips, and sticky notes.", priceInr: 399, compareAtPriceInr: 459, stockOnHand: 40 },
      { title: "Sticky Notes Multi Pack", description: "Colorful sticky notes for reminders and quick task markers.", priceInr: 119, compareAtPriceInr: 149, stockOnHand: 180 },
      { title: "Magnetic Bookmark Set", description: "Handy magnetic bookmarks for planners and textbooks.", priceInr: 169, compareAtPriceInr: 199, stockOnHand: 95 }
    ]
  },
  {
    name: "Planners & Diaries",
    slug: "planners-and-diaries",
    items: [
      { title: "Weekly Productivity Planner", description: "Plan weekly goals, tasks, and priorities with ease.", priceInr: 279, compareAtPriceInr: 329, stockOnHand: 70 },
      { title: "Undated Goal Diary", description: "Flexible undated diary for routines, goals, and reflections.", priceInr: 319, compareAtPriceInr: 369, stockOnHand: 65 },
      { title: "Monthly Habit Tracker Journal", description: "Track habits and progress month by month on clean layouts.", priceInr: 259, compareAtPriceInr: 309, stockOnHand: 85 }
    ]
  }
];

async function main() {
  const brand = await prisma.brand.upsert({
    where: { slug: "paper-serenity-basics" },
    update: { name: "Paper Serenity Basics", isActive: true },
    create: { name: "Paper Serenity Basics", slug: "paper-serenity-basics", isActive: true }
  });

  const categoryMap = new Map();
  for (const category of categorySeed) {
    const row = await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, isActive: true },
      create: { name: category.name, slug: category.slug, isActive: true }
    });
    categoryMap.set(category.slug, row);
  }

  const notebooks = categoryMap.get("notebooks-and-journals");
  const pens = categoryMap.get("pens-and-writing");

  if (notebooks && pens) {
    const movedPens = await prisma.product.updateMany({
      where: {
        categoryId: notebooks.id,
        OR: [
          { title: { contains: "pen", mode: "insensitive" } },
          { title: { contains: "marker", mode: "insensitive" } },
          { title: { contains: "writing", mode: "insensitive" } }
        ]
      },
      data: { categoryId: pens.id }
    });
    console.log(`Moved ${movedPens.count} writing products to Pens and Markers.`);
  }

  for (const category of categorySeed) {
    const categoryRow = categoryMap.get(category.slug);
    if (!categoryRow) continue;

    for (let index = 0; index < category.items.length; index += 1) {
      const item = category.items[index];
      const existingProduct = await prisma.product.findFirst({
        where: {
          categoryId: categoryRow.id,
          title: item.title
        },
        select: { id: true }
      });

      let productId = existingProduct?.id;
      if (!productId) {
        const slug = await uniqueProductSlug(slugify(item.title));
        const product = await prisma.product.create({
          data: {
            title: item.title,
            slug,
            description: item.description,
            categoryId: categoryRow.id,
            brandId: brand.id,
            hsnCode: "4820",
            gstPercent: 18,
            isInvoiceEligible: true,
            status: "published"
          },
          select: { id: true }
        });
        productId = product.id;
      }

      const sku = `DUMMY-${category.slug.replace(/-/g, "").slice(0, 8).toUpperCase()}-${index + 1}`;
      const variant = await prisma.productVariant.upsert({
        where: { sku },
        update: {
          productId,
          priceInr: item.priceInr,
          compareAtPriceInr: item.compareAtPriceInr,
          isActive: true,
          attributesJson: { pack: "standard" }
        },
        create: {
          productId,
          sku,
          priceInr: item.priceInr,
          compareAtPriceInr: item.compareAtPriceInr,
          isActive: true,
          attributesJson: { pack: "standard" }
        },
        select: { id: true }
      });

      await prisma.inventoryItem.upsert({
        where: { variantId: variant.id },
        update: {
          stockOnHand: item.stockOnHand,
          lowStockThreshold: 8
        },
        create: {
          variantId: variant.id,
          stockOnHand: item.stockOnHand,
          lowStockThreshold: 8
        }
      });
    }
  }

  const categoryCounts = await prisma.category.findMany({
    where: { slug: { in: categorySeed.map((c) => c.slug) } },
    select: {
      name: true,
      slug: true,
      products: {
        where: { status: "published" },
        select: { id: true }
      }
    },
    orderBy: { name: "asc" }
  });

  console.log("\nPublished products per category:");
  for (const c of categoryCounts) {
    console.log(`- ${c.name} (${c.slug}): ${c.products.length}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
