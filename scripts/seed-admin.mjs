import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const roles = [
    { code: "owner_admin", name: "Owner/Admin" },
    { code: "catalog_manager", name: "Catalog Manager" },
    { code: "order_operations", name: "Order Operations" },
    { code: "customer", name: "Customer" }
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: role
    });
  }

  const email = (process.env.ADMIN_EMAIL || "admin@stationery.local").toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "ChangeMe@123";

  const adminUser = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash: hashPassword(password),
      isActive: true
    },
    create: {
      email,
      passwordHash: hashPassword(password),
      isActive: true,
      profile: {
        create: {
          firstName: "Stationery",
          lastName: "Admin"
        }
      }
    }
  });

  const ownerRole = await prisma.role.findUnique({ where: { code: "owner_admin" } });

  if (ownerRole) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: adminUser.id,
          roleId: ownerRole.id
        }
      },
      update: {},
      create: {
        userId: adminUser.id,
        roleId: ownerRole.id
      }
    });
  }

  const notebookCategory = await prisma.category.upsert({
    where: { slug: "notebooks-and-journals" },
    update: { name: "Notebooks & Journals", isActive: true },
    create: {
      name: "Notebooks & Journals",
      slug: "notebooks-and-journals",
      isActive: true
    }
  });

  await prisma.category.upsert({
    where: { slug: "pens-and-writing" },
    update: { name: "Pens and Markers", isActive: true },
    create: {
      name: "Pens and Markers",
      slug: "pens-and-writing",
      isActive: true
    }
  });

  const brand = await prisma.brand.upsert({
    where: { slug: "scribe-and-co" },
    update: { name: "Scribe & Co", isActive: true },
    create: {
      name: "Scribe & Co",
      slug: "scribe-and-co",
      isActive: true
    }
  });

  const products = [
    {
      title: "A5 Premium Journal",
      slug: "a5-premium-journal",
      description: "Hardbound ivory dotted notebook for daily planning and notes.",
      sku: "SKU-A5-JOURNAL-001",
      priceInr: 399,
      compareAt: 549
    },
    {
      title: "Fine Gel Pen Set",
      slug: "fine-gel-pen-set",
      description: "Smooth 0.5mm gel pens designed for long writing sessions.",
      sku: "SKU-GEL-PEN-SET-010",
      priceInr: 249,
      compareAt: 320
    },
    {
      title: "Dual Tip Marker Kit",
      slug: "dual-tip-marker-kit",
      description: "Dual-tip marker set for illustration, highlighting, and journaling.",
      sku: "SKU-MARKER-KIT-024",
      priceInr: 899,
      compareAt: 1199
    }
  ];

  const createdVariants = [];

  for (const product of products) {
    const createdProduct = await prisma.product.upsert({
      where: { slug: product.slug },
      update: {
        title: product.title,
        description: product.description,
        status: "published",
        categoryId: notebookCategory.id,
        brandId: brand.id,
        hsnCode: "4820",
        gstPercent: 18
      },
      create: {
        title: product.title,
        slug: product.slug,
        description: product.description,
        status: "published",
        categoryId: notebookCategory.id,
        brandId: brand.id,
        hsnCode: "4820",
        gstPercent: 18
      }
    });

    const variant = await prisma.productVariant.upsert({
      where: { sku: product.sku },
      update: {
        priceInr: product.priceInr,
        compareAtPriceInr: product.compareAt,
        isActive: true,
        productId: createdProduct.id,
        attributesJson: { pack: "single" }
      },
      create: {
        productId: createdProduct.id,
        sku: product.sku,
        attributesJson: { pack: "single" },
        priceInr: product.priceInr,
        compareAtPriceInr: product.compareAt,
        isActive: true
      }
    });

    await prisma.inventoryItem.upsert({
      where: { variantId: variant.id },
      update: {
        stockOnHand: 50,
        lowStockThreshold: 8
      },
      create: {
        variantId: variant.id,
        stockOnHand: 50,
        lowStockThreshold: 8
      }
    });

    createdVariants.push(variant);
  }

  await prisma.coupon.upsert({
    where: { code: "WELCOME10" },
    update: {
      discountType: "percent",
      discountValue: 10,
      status: "active",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    },
    create: {
      code: "WELCOME10",
      discountType: "percent",
      discountValue: 10,
      status: "active",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
    }
  });

  const sampleOrderNumber = "ORD-10021";
  const existingOrder = await prisma.order.findUnique({ where: { orderNumber: sampleOrderNumber } });
  if (!existingOrder && createdVariants[0]) {
    const subtotal = createdVariants[0].priceInr;
    const tax = Math.round((subtotal * 18) / 100);

    await prisma.order.create({
      data: {
        orderNumber: sampleOrderNumber,
        userId: adminUser.id,
        status: "confirmed",
        subtotalInr: subtotal,
        taxTotalInr: tax,
        grandTotalInr: subtotal + tax,
        paymentMethod: "card",
        paymentStatus: "paid",
        shippingAddressSnapshot: {
          line1: "123 Market Road",
          city: "Chandigarh",
          state: "Punjab",
          postalCode: "160001"
        },
        billingAddressSnapshot: {
          line1: "123 Market Road",
          city: "Chandigarh",
          state: "Punjab",
          postalCode: "160001"
        },
        items: {
          create: {
            variantId: createdVariants[0].id,
            titleSnapshot: "A5 Premium Journal",
            skuSnapshot: createdVariants[0].sku,
            quantity: 1,
            unitPriceInr: subtotal,
            taxPercent: 18,
            taxAmountInr: tax,
            lineTotalInr: subtotal + tax
          }
        }
      }
    });
  }

  console.log("Seed complete");
  console.log(`Admin email: ${email}`);
  console.log(`Admin password: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });