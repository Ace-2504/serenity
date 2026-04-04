import { NextRequest, NextResponse } from "next/server";
import { createInventoryItem, InventoryValidationError, normalizeStatus } from "@/lib/admin-inventory";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BulkRow = {
  title?: string;
  description?: string;
  hsnCode?: string;
  gstPercent?: string | number;
  sku?: string;
  priceInr?: string | number;
  compareAtPriceInr?: string | number | null;
  stockOnHand?: string | number;
  lowStockThreshold?: string | number;
  status?: string;
  categoryId?: string;
  brandId?: string;
  categoryName?: string;
  brandName?: string;
};

function toInt(value: unknown): number {
  return Number.parseInt(String(value ?? ""), 10);
}

export async function POST(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const rows = (body.rows ?? []) as BulkRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ message: "rows array is required." }, { status: 400 });
  }

  const created: Array<{ sku: string; productTitle: string }> = [];
  const errors: Array<{ row: number; sku: string; message: string }> = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sku = String(row.sku ?? "").trim().toUpperCase();

    try {
      const result = await prisma.$transaction(async (tx) =>
        createInventoryItem(tx, {
          title: String(row.title ?? "").trim(),
          description: String(row.description ?? "").trim(),
          hsnCode: String(row.hsnCode ?? "").trim(),
          gstPercent: toInt(row.gstPercent),
          sku,
          priceInr: toInt(row.priceInr),
          compareAtPriceInr:
            row.compareAtPriceInr === null || String(row.compareAtPriceInr ?? "").trim() === ""
              ? null
              : toInt(row.compareAtPriceInr),
          stockOnHand: toInt(row.stockOnHand),
          lowStockThreshold: row.lowStockThreshold ? toInt(row.lowStockThreshold) : 8,
          status: normalizeStatus(row.status),
          categoryId: String(row.categoryId ?? "").trim(),
          brandId: String(row.brandId ?? "").trim(),
          newCategoryName: String(row.categoryName ?? "").trim(),
          newBrandName: String(row.brandName ?? "").trim()
        })
      );

      created.push({
        sku: result.variant.sku,
        productTitle: result.product.title
      });
    } catch (error) {
      if (error instanceof InventoryValidationError) {
        errors.push({ row: index + 1, sku, message: error.message });
      } else {
        errors.push({ row: index + 1, sku, message: "Unexpected server error." });
      }
    }
  }

  return NextResponse.json({
    totalRows: rows.length,
    createdCount: created.length,
    failedCount: errors.length,
    created,
    errors
  });
}
