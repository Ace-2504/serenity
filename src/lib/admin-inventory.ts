import { Prisma, ProductStatus } from "@prisma/client";

type TxClient = Prisma.TransactionClient;

export type CreateInventoryPayload = {
  title: string;
  description: string;
  hsnCode: string;
  gstPercent: number;
  sku: string;
  priceInr: number;
  compareAtPriceInr: number | null;
  stockOnHand: number;
  lowStockThreshold: number;
  status: ProductStatus;
  categoryId?: string;
  brandId?: string;
  newCategoryName?: string;
  newBrandName?: string;
};

export class InventoryValidationError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function makeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function normalizeStatus(raw: unknown): ProductStatus {
  return String(raw ?? "draft").toLowerCase() === "published" ? ProductStatus.published : ProductStatus.draft;
}

async function findOrCreateCategory(tx: TxClient, payload: CreateInventoryPayload): Promise<string> {
  if (payload.newCategoryName?.trim()) {
    const name = payload.newCategoryName.trim();
    const slug = makeSlug(name);
    if (!slug) {
      throw new InventoryValidationError("New category name is invalid.");
    }

    const existing = await tx.category.findUnique({ where: { slug } });
    if (existing) {
      return existing.id;
    }

    const created = await tx.category.create({
      data: {
        name,
        slug,
        isActive: true
      }
    });
    return created.id;
  }

  const categoryId = payload.categoryId?.trim();
  if (!categoryId) {
    throw new InventoryValidationError("Category is required.");
  }

  const category = await tx.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new InventoryValidationError("Selected category does not exist.", 404);
  }

  return category.id;
}

async function findOrCreateBrand(tx: TxClient, payload: CreateInventoryPayload): Promise<string> {
  if (payload.newBrandName?.trim()) {
    const name = payload.newBrandName.trim();
    const slug = makeSlug(name);
    if (!slug) {
      throw new InventoryValidationError("New brand name is invalid.");
    }

    const existing = await tx.brand.findUnique({ where: { slug } });
    if (existing) {
      return existing.id;
    }

    const created = await tx.brand.create({
      data: {
        name,
        slug,
        isActive: true
      }
    });
    return created.id;
  }

  const brandId = payload.brandId?.trim();
  if (!brandId) {
    throw new InventoryValidationError("Brand is required.");
  }

  const brand = await tx.brand.findUnique({ where: { id: brandId } });
  if (!brand) {
    throw new InventoryValidationError("Selected brand does not exist.", 404);
  }

  return brand.id;
}

async function createUniqueProductSlug(tx: TxClient, title: string): Promise<string> {
  const baseSlug = makeSlug(title);
  if (!baseSlug) {
    throw new InventoryValidationError("Unable to generate a valid slug from title.");
  }

  let productSlug = baseSlug;
  let suffix = 1;
  while (await tx.product.findUnique({ where: { slug: productSlug } })) {
    suffix += 1;
    productSlug = `${baseSlug}-${suffix}`;
  }

  return productSlug;
}

export async function createInventoryItem(tx: TxClient, payload: CreateInventoryPayload) {
  if (
    !payload.title ||
    !payload.description ||
    !payload.hsnCode ||
    !payload.sku ||
    Number.isNaN(payload.gstPercent) ||
    Number.isNaN(payload.priceInr) ||
    Number.isNaN(payload.stockOnHand)
  ) {
    throw new InventoryValidationError("Missing required fields.");
  }

  if (payload.priceInr <= 0 || payload.stockOnHand < 0 || payload.gstPercent < 0 || payload.gstPercent > 50) {
    throw new InventoryValidationError("Invalid price, stock, or GST values.");
  }

  if (
    payload.compareAtPriceInr !== null &&
    (Number.isNaN(payload.compareAtPriceInr) || payload.compareAtPriceInr < payload.priceInr)
  ) {
    throw new InventoryValidationError("Compare-at price must be greater than or equal to selling price.");
  }

  const existingSku = await tx.productVariant.findUnique({ where: { sku: payload.sku } });
  if (existingSku) {
    throw new InventoryValidationError("SKU already exists. Use a unique SKU.", 409);
  }

  const [categoryId, brandId, productSlug] = await Promise.all([
    findOrCreateCategory(tx, payload),
    findOrCreateBrand(tx, payload),
    createUniqueProductSlug(tx, payload.title)
  ]);

  const product = await tx.product.create({
    data: {
      title: payload.title,
      slug: productSlug,
      description: payload.description,
      categoryId,
      brandId,
      hsnCode: payload.hsnCode,
      gstPercent: payload.gstPercent,
      status: payload.status
    }
  });

  const variant = await tx.productVariant.create({
    data: {
      productId: product.id,
      sku: payload.sku,
      attributesJson: { pack: "single" },
      priceInr: payload.priceInr,
      compareAtPriceInr: payload.compareAtPriceInr,
      isActive: true
    }
  });

  const inventory = await tx.inventoryItem.create({
    data: {
      variantId: variant.id,
      stockOnHand: payload.stockOnHand,
      lowStockThreshold: payload.lowStockThreshold
    }
  });

  return { product, variant, inventory };
}
