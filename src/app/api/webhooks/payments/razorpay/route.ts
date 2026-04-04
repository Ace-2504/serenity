import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRazorpayEnabled, verifyRazorpayWebhookSignature } from "@/lib/payment-provider";

export const dynamic = "force-dynamic";

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        currency?: string;
        error_code?: string;
      };
    };
  };
};

export async function POST(request: NextRequest) {
  if (!isRazorpayEnabled()) {
    return NextResponse.json({ ok: true, ignored: "razorpay disabled" });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? undefined;

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 401 });
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
  }

  const event = payload.event;
  const paymentEntity = payload.payload?.payment?.entity;
  const providerPaymentId = paymentEntity?.id;
  const providerOrderId = paymentEntity?.order_id;

  if (!event || !providerOrderId) {
    return NextResponse.json({ message: "Missing event data" }, { status: 400 });
  }

  const paymentRecord = await prisma.payment.findFirst({
    where: {
      provider: "razorpay",
      providerOrderId
    },
    include: { order: true }
  });

  if (!paymentRecord) {
    return NextResponse.json({ ok: true, ignored: "payment record not found" });
  }

  if (event === "payment.captured") {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentRecord.id },
        data: {
          providerPaymentId,
          status: "captured",
          rawPayloadJson: payload,
          amountInr: Math.round((paymentEntity?.amount ?? paymentRecord.amountInr * 100) / 100),
          currency: paymentEntity?.currency ?? paymentRecord.currency,
          failureCode: null
        }
      });

      await tx.order.update({
        where: { id: paymentRecord.orderId },
        data: {
          paymentStatus: "paid",
          status: paymentRecord.order.status === "pending_payment" ? "confirmed" : paymentRecord.order.status
        }
      });
    });
  } else if (event === "payment.failed") {
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentRecord.id },
        data: {
          providerPaymentId,
          status: "failed",
          failureCode: paymentEntity?.error_code,
          rawPayloadJson: payload
        }
      });

      await tx.order.update({
        where: { id: paymentRecord.orderId },
        data: {
          paymentStatus: "failed"
        }
      });
    });
  }

  return NextResponse.json({ ok: true });
}