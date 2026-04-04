import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { calculateCheckoutFromCart } from "@/lib/checkout";
import { isRazorpayEnabled } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

  return NextResponse.json({
    canCheckout: summary.stockIssues.length === 0,
    stockIssues: summary.stockIssues,
    totals: summary.totals,
    codEligibility: summary.codEligibility,
    onlinePaymentsEnabled: isRazorpayEnabled(),
    lineItems: summary.lineItems
  });
}