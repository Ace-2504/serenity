import { NextResponse, type NextRequest } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { queueWebsiteSync } from "@/server/adapters/website/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Records that a cash-on-delivery order's money was collected, so the books show it received. */
export async function POST(request: NextRequest, { params }: { params: { orderId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations"]);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const order = await prisma.order.findUnique({ where: { id: params.orderId }, include: { payments: true } });
  if (!order) return NextResponse.json({ message: "Order not found" }, { status: 404 });
  if (order.paymentMethod !== "cod" || order.paymentStatus !== "cod_pending") return NextResponse.json({ message: "Only an unpaid cash-on-delivery order can be marked collected" }, { status: 409 });
  if (!["shipped", "delivered"].includes(order.status)) return NextResponse.json({ message: "Mark the order shipped or delivered first" }, { status: 409 });
  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { paymentStatus: "paid" } }),
    prisma.payment.updateMany({ where: { orderId: order.id, provider: "internal-cod" }, data: { status: "captured" } })
  ]);
  await queueWebsiteSync("cash collected");
  return NextResponse.json({ ok: true });
}
