import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { createGatewayOrder, isRazorpayEnabled } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: { paymentId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "order_operations"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!isRazorpayEnabled()) {
    return NextResponse.json({ message: "Razorpay is currently disabled." }, { status: 503 });
  }

  const payment = await prisma.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: true }
  });

  if (!payment) {
    return NextResponse.json({ message: "Payment not found" }, { status: 404 });
  }

  if (payment.order.paymentMethod === "cod") {
    return NextResponse.json({ message: "COD orders do not support payment retry" }, { status: 400 });
  }

  if (payment.status === "captured") {
    return NextResponse.json({ message: "Payment already captured" }, { status: 400 });
  }

  const gatewayOrder = await createGatewayOrder({
    amountInr: payment.order.grandTotalInr,
    receipt: `retry_${payment.order.orderNumber}_${Date.now()}`
  });

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "created",
      providerOrderId: gatewayOrder.providerOrderId,
      failureCode: null,
      rawPayloadJson: {
        retryAt: new Date().toISOString(),
        previousProviderOrderId: payment.providerOrderId
      }
    }
  });

  await prisma.order.update({
    where: { id: payment.orderId },
    data: {
      paymentStatus: "pending",
      status: payment.order.status === "cancelled" ? "cancelled" : "pending_payment"
    }
  });

  return NextResponse.json({
    ok: true,
    paymentId: updated.id,
    paymentIntentId: gatewayOrder.providerOrderId,
    provider: gatewayOrder.provider,
    amountInr: gatewayOrder.amountInr,
    currency: gatewayOrder.currency
  });
}