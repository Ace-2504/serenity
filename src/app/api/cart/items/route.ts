import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const variantId = String(body.variantId ?? "");
  const quantity = Number(body.quantity ?? 1);

  if (!variantId || !Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }

  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { inventory: true }
  });

  if (!variant || !variant.isActive) {
    return NextResponse.json({ message: "Variant not found" }, { status: 404 });
  }

  const availableStock = variant.inventory?.stockOnHand ?? 0;
  if (availableStock < quantity) {
    return NextResponse.json({ message: "Insufficient stock" }, { status: 409 });
  }

  const cart = await prisma.cart.upsert({
    where: { userId: session.userId },
    update: {},
    create: { userId: session.userId }
  });

  const item = await prisma.cartItem.upsert({
    where: {
      cartId_variantId: {
        cartId: cart.id,
        variantId
      }
    },
    update: {
      quantity,
      unitPriceSnapshotInr: variant.priceInr
    },
    create: {
      cartId: cart.id,
      variantId,
      quantity,
      unitPriceSnapshotInr: variant.priceInr
    }
  });

  return NextResponse.json({
    id: item.id,
    variantId: item.variantId,
    quantity: item.quantity,
    unitPriceInr: item.unitPriceSnapshotInr
  });
}