import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: { addressId: string } }) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const address = await prisma.address.findFirst({
    where: {
      id: params.addressId,
      userId: session.userId
    }
  });

  if (!address) {
    return NextResponse.json({ message: "Address not found" }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.address.updateMany({
      where: { userId: session.userId, isDefault: true },
      data: { isDefault: false }
    }),
    prisma.address.update({
      where: { id: address.id },
      data: { isDefault: true }
    })
  ]);

  return NextResponse.json({ ok: true });
}