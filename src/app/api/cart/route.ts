import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const cart = await prisma.cart.findUnique({
    where: { userId: session.userId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: true
            }
          }
        }
      }
    }
  });

  if (!cart) {
    return NextResponse.json({ items: [], summary: { subtotalInr: 0, itemCount: 0 } });
  }

  const subtotalInr = cart.items.reduce((sum, item) => sum + item.unitPriceSnapshotInr * item.quantity, 0);
  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  return NextResponse.json({
    items: cart.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productTitle: item.variant.product.title,
      sku: item.variant.sku,
      quantity: item.quantity,
      unitPriceInr: item.unitPriceSnapshotInr,
      lineTotalInr: item.unitPriceSnapshotInr * item.quantity
    })),
    summary: { subtotalInr, itemCount }
  });
}