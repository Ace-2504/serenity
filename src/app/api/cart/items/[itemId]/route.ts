import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { itemId: string } }) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const quantity = Number((await request.json()).quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ message: "Quantity must be at least 1" }, { status: 400 });
  }

  const item = await prisma.cartItem.findUnique({
    where: { id: params.itemId },
    include: { cart: true, variant: { include: { inventory: true } } }
  });

  if (!item || item.cart.userId !== session.userId) {
    return NextResponse.json({ message: "Item not found" }, { status: 404 });
  }

  const stock = item.variant.inventory?.stockOnHand ?? 0;
  if (stock < quantity) {
    return NextResponse.json({ message: "Insufficient stock" }, { status: 409 });
  }

  const updated = await prisma.cartItem.update({
    where: { id: params.itemId },
    data: { quantity }
  });

  return NextResponse.json({ id: updated.id, quantity: updated.quantity });
}

export async function DELETE(request: NextRequest, { params }: { params: { itemId: string } }) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const item = await prisma.cartItem.findUnique({
    where: { id: params.itemId },
    include: { cart: true }
  });

  if (!item || item.cart.userId !== session.userId) {
    return NextResponse.json({ message: "Item not found" }, { status: 404 });
  }

  await prisma.cartItem.delete({ where: { id: params.itemId } });
  return NextResponse.json({ ok: true });
}