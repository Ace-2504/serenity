import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRequestAuth } from "@/lib/auth";
import { calculateCheckoutFromCart } from "@/lib/checkout";
import { fetchRazorpayPayment, isRazorpayEnabled, verifyRazorpayPaymentSignature } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function generateOrderNumber(): string {
  return `ORD-${Date.now()}`;
}

export async function POST(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const paymentMethod = String(body.paymentMethod ?? "").toLowerCase();
  const paymentIntentId = String(body.paymentIntentId ?? "");
  const addressId = String(body.addressId ?? "").trim();
  const providerPaymentId = String(body.providerPaymentId ?? "").trim();
  const providerSignature = String(body.providerSignature ?? "").trim();

  if (!["upi", "card", "cod"].includes(paymentMethod)) {
    return NextResponse.json({ message: "Unsupported payment method" }, { status: 400 });
  }

  const address = addressId
    ? await prisma.address.findFirst({
        where: { id: addressId, userId: session.userId }
      })
    : await prisma.address.findFirst({
        where: { userId: session.userId, isDefault: true }
      });

  if (!address) {
    return NextResponse.json({ message: "A saved delivery address is required before placing an order" }, { status: 400 });
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

  if ((paymentMethod === "upi" || paymentMethod === "card") && !isRazorpayEnabled()) {
    return NextResponse.json({ message: "Online payments are temporarily unavailable." }, { status: 503 });
  }

  if ((paymentMethod === "upi" || paymentMethod === "card") && !paymentIntentId) {
    return NextResponse.json({ message: "paymentIntentId is required for online payments" }, { status: 400 });
  }

  if ((paymentMethod === "upi" || paymentMethod === "card") && (!providerPaymentId || !providerSignature)) {
    return NextResponse.json({ message: "Verified Razorpay payment details are required for online payments" }, { status: 400 });
  }

  if (paymentMethod === "cod" && !summary.codEligibility.allowed) {
    return NextResponse.json({ message: "COD is not eligible for this order" }, { status: 400 });
  }

  const shippingAddressSnapshot = {
    label: address.label,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone
  };

  let onlinePaymentRecord:
    | {
        provider: "razorpay";
        providerOrderId: string;
        providerPaymentId: string;
        status: "authorized" | "captured";
        amountInr: number;
        currency: string;
        rawPayloadJson: Prisma.InputJsonValue;
      }
    | null = null;

  if (paymentMethod === "upi" || paymentMethod === "card") {
    const existingPayment = await prisma.payment.findUnique({ where: { providerPaymentId } });
    if (existingPayment) {
      return NextResponse.json({ message: "This Razorpay payment has already been processed." }, { status: 409 });
    }

    const hasValidSignature = verifyRazorpayPaymentSignature({
      orderId: paymentIntentId,
      paymentId: providerPaymentId,
      signature: providerSignature
    });

    if (!hasValidSignature) {
      return NextResponse.json({ message: "Unable to verify Razorpay payment signature." }, { status: 400 });
    }

    const razorpayPayment = await fetchRazorpayPayment(providerPaymentId);
    if (!razorpayPayment) {
      return NextResponse.json({ message: "Unable to fetch Razorpay payment details." }, { status: 502 });
    }

    if (razorpayPayment.order_id !== paymentIntentId) {
      return NextResponse.json({ message: "Razorpay order mismatch." }, { status: 400 });
    }

    if (!["authorized", "captured"].includes(razorpayPayment.status)) {
      return NextResponse.json({ message: `Payment is ${razorpayPayment.status}. Complete payment before placing the order.` }, { status: 409 });
    }

    const paidAmountInr = Math.round(razorpayPayment.amount / 100);
    if (paidAmountInr !== summary.totals.grandTotalInr) {
      return NextResponse.json({ message: "Paid amount does not match the checkout total." }, { status: 409 });
    }

    const verifiedPaymentStatus = razorpayPayment.status === "captured" ? "captured" : "authorized";

    onlinePaymentRecord = {
      provider: "razorpay",
      providerOrderId: paymentIntentId,
      providerPaymentId,
      status: verifiedPaymentStatus,
      amountInr: paidAmountInr,
      currency: razorpayPayment.currency,
      rawPayloadJson: {
        checkout: {
          paymentMethod,
          providerOrderId: paymentIntentId,
          providerPaymentId,
          providerSignature
        },
        razorpayPayment
      }
    };
  }

  const order = await prisma.$transaction(async (tx) => {
    for (const item of cart.items) {
      const inventory = await tx.inventoryItem.findUnique({ where: { variantId: item.variantId } });
      const available = inventory?.stockOnHand ?? 0;
      if (available < item.quantity) {
        throw new Error(`INSUFFICIENT_STOCK:${item.id}`);
      }
    }

    for (const item of cart.items) {
      await tx.inventoryItem.update({
        where: { variantId: item.variantId },
        data: {
          stockOnHand: {
            decrement: item.quantity
          }
        }
      });
    }

    const created = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        userId: session.userId,
        status: paymentMethod === "cod" ? "confirmed" : "confirmed",
        subtotalInr: summary.totals.subtotalInr,
        discountTotalInr: 0,
        taxTotalInr: summary.totals.taxTotalInr,
        shippingTotalInr: 0,
        grandTotalInr: summary.totals.grandTotalInr,
        paymentMethod: paymentMethod as "upi" | "card" | "cod",
        paymentStatus: paymentMethod === "cod" ? "cod_pending" : "paid",
        shippingAddressSnapshot,
        billingAddressSnapshot: shippingAddressSnapshot,
        items: {
          create: summary.lineItems.map((item) => ({
            variantId: item.variantId,
            titleSnapshot: item.productTitle,
            skuSnapshot: item.sku,
            quantity: item.quantity,
            unitPriceInr: item.unitPriceInr,
            taxPercent: item.taxPercent,
            taxAmountInr: item.lineTaxInr,
            lineTotalInr: item.lineSubtotalInr + item.lineTaxInr
          }))
        }
      }
    });

    await tx.payment.create({
      data: {
        orderId: created.id,
        provider: paymentMethod === "cod" ? "internal-cod" : onlinePaymentRecord!.provider,
        providerOrderId: paymentMethod === "cod" ? null : onlinePaymentRecord!.providerOrderId,
        providerPaymentId: paymentMethod === "cod" ? null : onlinePaymentRecord!.providerPaymentId,
        status: paymentMethod === "cod" ? "authorized" : onlinePaymentRecord!.status,
        amountInr: paymentMethod === "cod" ? summary.totals.grandTotalInr : onlinePaymentRecord!.amountInr,
        currency: paymentMethod === "cod" ? "INR" : onlinePaymentRecord!.currency,
        rawPayloadJson: paymentMethod === "cod"
          ? {
              paymentMethod,
              paymentIntentId: null
            }
          : onlinePaymentRecord!.rawPayloadJson
      }
    });

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    return created;
  });

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    amountInr: order.grandTotalInr
  });
}