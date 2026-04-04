import { createHmac } from "node:crypto";
import Razorpay from "razorpay";

type GatewayOrderInput = {
  amountInr: number;
  receipt: string;
};

type RazorpayPaymentEntity = {
  id: string;
  amount: number;
  currency: string;
  order_id: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  method?: string;
};

export function isRazorpayEnabled(): boolean {
  return process.env.RAZORPAY_ENABLED === "true";
}

export function hasRazorpayConfig(): boolean {
  return isRazorpayEnabled() && Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function getRazorpayKeyId(): string | null {
  return hasRazorpayConfig() ? process.env.RAZORPAY_KEY_ID || null : null;
}

function getRazorpayClient(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return null;
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function createGatewayOrder(input: GatewayOrderInput) {
  const client = getRazorpayClient();
  if (!client) {
    throw new Error("Razorpay is not configured");
  }

  const order = await client.orders.create({
    amount: input.amountInr * 100,
    currency: "INR",
    receipt: input.receipt,
    payment_capture: true
  });

  return {
    provider: "razorpay",
    providerOrderId: order.id,
    amountInr: Math.round(Number(order.amount) / 100),
    currency: order.currency
  };
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature?: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret || !input.signature) {
    return false;
  }

  const body = `${input.orderId}|${input.paymentId}`;
  const digest = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return digest === input.signature;
}

export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentEntity | null> {
  const client = getRazorpayClient();
  if (!client) {
    return null;
  }

  const payment = await client.payments.fetch(paymentId);
  return {
    id: payment.id,
    amount: Number(payment.amount),
    currency: payment.currency,
    order_id: payment.order_id,
    status: payment.status as RazorpayPaymentEntity["status"],
    method: payment.method
  };
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature?: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) {
    return false;
  }

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return digest === signature;
}