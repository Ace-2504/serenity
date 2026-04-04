import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const orders = await prisma.order.findMany({
    orderBy: { placedAt: "desc" },
    take: 25,
    include: {
      user: {
        select: {
          email: true,
          profile: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      }
    }
  });

  const items = orders.map((order) => ({
    id: order.orderNumber,
    customer:
      order.user.profile && order.user.profile.firstName
        ? `${order.user.profile.firstName} ${order.user.profile.lastName}`.trim()
        : order.user.email,
    status: order.status,
    value: order.grandTotalInr
  }));

  return NextResponse.json({ items });
}