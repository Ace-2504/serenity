import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { isRazorpayEnabled } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!isRazorpayEnabled()) {
    return NextResponse.json({ message: "Razorpay is currently disabled." }, { status: 503 });
  }

  const payments = await prisma.payment.findMany({
    include: { order: true },
    orderBy: { updatedAt: "desc" },
    take: 200
  });

  let updated = 0;

  for (const payment of payments) {
    if (payment.status === "captured" && payment.order.paymentStatus !== "paid") {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: "paid",
          status: payment.order.status === "pending_payment" ? "confirmed" : payment.order.status
        }
      });
      updated += 1;
      continue;
    }

    if (payment.status === "failed" && payment.order.paymentStatus !== "failed") {
      await prisma.order.update({
        where: { id: payment.orderId },
        data: {
          paymentStatus: "failed"
        }
      });
      updated += 1;
    }
  }

  return NextResponse.json({ ok: true, updated });
}