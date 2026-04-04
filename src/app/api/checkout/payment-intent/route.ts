import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { calculateCheckoutFromCart } from "@/lib/checkout";
import { createGatewayOrder, getRazorpayKeyId, hasRazorpayConfig, isRazorpayEnabled } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const paymentMethod = String(body.paymentMethod ?? "").toLowerCase();

  if (!["upi", "card", "cod"].includes(paymentMethod)) {
    return NextResponse.json({ message: "Unsupported payment method" }, { status: 400 });
  }

  const cart = await prisma.cart.findUnique({
    where: { userId: session.userId },
    include: {
      items: {
        include: {
          variant: {
            include: { product: true, inventory: true }
          }
        }
      }
    }
  });

  if (!cart || cart.items.length === 0) {
    return NextResponse.json({ message: "Cart is empty" }, { status: 400 });
  }

  const summary = calculateCheckoutFromCart(cart);
  if (summary.stockIssues.length > 0) {
    return NextResponse.json({ message: "Cart has stock issues", stockIssues: summary.stockIssues }, { status: 409 });
  }

  if (paymentMethod === "cod" && !summary.codEligibility.allowed) {
    return NextResponse.json({ message: "COD is not eligible for this order" }, { status: 400 });
  }

  if (paymentMethod === "cod") {
    return NextResponse.json({
      paymentIntentId: `cod_${session.userId.slice(0, 8)}_${Date.now()}`,
      provider: "internal-cod",
      amountInr: summary.totals.grandTotalInr,
      currency: "INR",
      paymentMethod
    });
  }

  if (!isRazorpayEnabled()) {
    return NextResponse.json({ message: "Online payments are temporarily unavailable." }, { status: 503 });
  }

  if (!hasRazorpayConfig()) {
    return NextResponse.json({ message: "Razorpay is enabled but not configured yet." }, { status: 503 });
  }

  const gatewayOrder = await createGatewayOrder({
    amountInr: summary.totals.grandTotalInr,
    receipt: `rcpt_${session.userId.slice(0, 8)}_${Date.now()}`
  });

  return NextResponse.json({
    paymentIntentId: gatewayOrder.providerOrderId,
    provider: gatewayOrder.provider,
    amountInr: gatewayOrder.amountInr,
    currency: gatewayOrder.currency,
    razorpayKeyId: getRazorpayKeyId(),
    paymentMethod
  });
}