import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const orders = await prisma.order.findMany({
    where: { userId: session.userId },
    orderBy: { placedAt: "desc" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      grandTotalInr: true,
      placedAt: true
    }
  });

  return NextResponse.json({ items: orders });
}