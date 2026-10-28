"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (event: string, handler: (response: unknown) => void) => void;
    };
  }
}

type RazorpayCheckoutOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: {
    ondismiss?: () => void;
  };
  theme?: {
    color?: string;
  };
};

type ValidateResponse = {
  canCheckout: boolean;
  stockIssues: string[];
  totals: {
    subtotalInr: number;
    taxTotalInr: number;
    shippingInr: number;
    discountInr: number;
    grandTotalInr: number;
  };
  codEligibility: {
    allowed: boolean;
    maxInr: number;
  };
  onlinePaymentsEnabled: boolean;
};

type PaymentIntentResponse = {
  paymentIntentId: string;
  provider: string;
  amountInr: number;
  currency: string;
  paymentMethod: string;
  razorpayKeyId?: string | null;
};

type AddressItem = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
};

function loadRazorpayCheckoutScript(): Promise<boolean> {
  if (typeof window === "undefined") {
    return Promise.resolve(false);
  }

  if (window.Razorpay) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function openRazorpayCheckout(input: {
  keyId: string;
  amountInr: number;
  currency: string;
  orderId: string;
}): Promise<{
  paymentId: string;
  orderId: string;
  signature: string;
}> {
  return new Promise((resolve, reject) => {
    if (!window.Razorpay) {
      reject(new Error("Razorpay Checkout is unavailable."));
      return;
    }

    let lastFailureReason = "Payment was cancelled before completion.";

    const razorpay = new window.Razorpay({
      key: input.keyId,
      amount: input.amountInr * 100,
      currency: input.currency,
      name: "Paper Serenity Stationery Hub",
      description: "Complete your order with a calm and secure checkout",
      order_id: input.orderId,
      handler: (response) => {
        resolve({
          paymentId: response.razorpay_payment_id,
          orderId: response.razorpay_order_id,
          signature: response.razorpay_signature
        });
      },
      modal: {
        ondismiss: () => reject(new Error(lastFailureReason))
      },
      theme: {
        color: "#2F6F68"
      }
    });

    razorpay.on("payment.failed", (response: unknown) => {
      const resp = response as { error?: { description?: string; reason?: string } };
      lastFailureReason =
        resp?.error?.description ??
        resp?.error?.reason ??
        "Payment failed. Please try a different card.";
    });

    razorpay.open();
  });
}

export default function CheckoutPage() {
  const [summary, setSummary] = useState<ValidateResponse | null>(null);
  const [addresses, setAddresses] = useState<AddressItem[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"upi" | "card" | "cod">("upi");
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [placedOrderNumber, setPlacedOrderNumber] = useState("");

  useEffect(() => {
    async function loadValidation() {
      setLoading(true);
      setError("");

      const [validationResponse, addressesResponse] = await Promise.all([
        fetch("/api/checkout/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }),
        fetch("/api/account/addresses", { cache: "no-store" })
      ]);

      if (!validationResponse.ok) {
        const data = (await validationResponse.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Unable to validate checkout.");
        setLoading(false);
        return;
      }

      if (!addressesResponse.ok) {
        const data = (await addressesResponse.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Unable to load saved addresses.");
        setLoading(false);
        return;
      }

      const data = (await validationResponse.json()) as ValidateResponse;
      const addressData = (await addressesResponse.json()) as { items: AddressItem[] };
      setSummary(data);
      setAddresses(addressData.items);
      setSelectedAddressId(addressData.items.find((item) => item.isDefault)?.id ?? addressData.items[0]?.id ?? "");
      if (!data.onlinePaymentsEnabled) {
        setPaymentMethod("cod");
      } else if (!data.codEligibility.allowed) {
        setPaymentMethod("upi");
      }
      setLoading(false);
    }

    void loadValidation();
  }, []);

  async function placeOrder() {
    if (!summary || !summary.canCheckout) {
      return;
    }

    if (!selectedAddressId) {
      setError("Please select a saved delivery address before placing your order.");
      return;
    }

    setPlacing(true);
    setError("");

    let paymentIntentId = "";
    let providerPaymentId = "";
    let providerSignature = "";
    if (paymentMethod !== "cod") {
      if (!summary.onlinePaymentsEnabled) {
        setError("Online payments are temporarily unavailable. Please use Cash on Delivery.");
        setPlacing(false);
        return;
      }

      const intentResponse = await fetch("/api/checkout/payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod })
      });

      if (!intentResponse.ok) {
        const data = (await intentResponse.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Unable to create payment intent.");
        setPlacing(false);
        return;
      }

      const intentData = (await intentResponse.json()) as PaymentIntentResponse;
      if (intentData.provider !== "razorpay" || !intentData.razorpayKeyId) {
        setError("Razorpay is not configured yet. Add your test keys and try again.");
        setPlacing(false);
        return;
      }

      const scriptLoaded = await loadRazorpayCheckoutScript();
      if (!scriptLoaded) {
        setError("Unable to load Razorpay Checkout. Please try again.");
        setPlacing(false);
        return;
      }

      paymentIntentId = intentData.paymentIntentId;

      try {
        const paymentResult = await openRazorpayCheckout({
          keyId: intentData.razorpayKeyId,
          amountInr: intentData.amountInr,
          currency: intentData.currency,
          orderId: intentData.paymentIntentId
        });

        providerPaymentId = paymentResult.paymentId;
        providerSignature = paymentResult.signature;
      } catch (checkoutError) {
        const message = checkoutError instanceof Error ? checkoutError.message : "Payment was not completed.";
        setError(message);
        setPlacing(false);
        return;
      }
    }

    const placeResponse = await fetch("/api/checkout/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentMethod,
        paymentIntentId,
        providerPaymentId,
        providerSignature,
        addressId: selectedAddressId
      })
    });

    if (!placeResponse.ok) {
      const data = (await placeResponse.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Order placement failed.");
      setPlacing(false);
      return;
    }

    const payload = (await placeResponse.json()) as { orderNumber: string };
    setPlacedOrderNumber(payload.orderNumber);
    setPlacing(false);
  }

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-16 pt-8 md:px-8 xl:px-12">
      <header className="mb-6 rounded-3xl border border-mist bg-gradient-to-br from-[#edf8f9] via-[#e2f0f3] to-[#d6e5ec] p-6 shadow-sm md:p-8">
        <div>
          <p className="inline-flex rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-forest">
            Checkout
          </p>
          <h1 className="mt-3 font-display text-4xl text-ink md:text-5xl">Complete Your Order</h1>
          <p className="mt-2 text-sm text-graphite">Confirm delivery address, choose payment method, and place your order securely.</p>
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/account/orders" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Orders
          </Link>
          <Link href="/cart" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Back to Cart
          </Link>
        </div>
      </header>

      {loading ? <p className="text-sm text-graphite">Validating checkout...</p> : null}
      {error ? <p className="mb-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">{error}</p> : null}

      {placedOrderNumber ? (
        <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-6 shadow-sm">
          <h2 className="text-2xl font-semibold">Order Placed</h2>
          <p className="mt-2 text-sm text-graphite">Your order number is {placedOrderNumber}.</p>
          <Link href="/" className="mt-4 inline-block rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest">
            Continue Shopping
          </Link>
        </section>
      ) : null}

      {!loading && summary && !placedOrderNumber ? (
        <section className="grid gap-4 rounded-2xl border border-mist bg-canvas/95 p-5 shadow-sm md:grid-cols-[1fr_320px]">
          <div>
            <h2 className="text-lg font-semibold">Delivery Address</h2>
            {addresses.length === 0 ? (
              <div className="mt-3 rounded-xl border border-terracotta bg-[#fce7e2] p-4 text-sm text-terracotta">
                No saved address found. <Link href="/account" className="font-semibold underline">Add an address in your account</Link> before checkout.
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-sm">
                {addresses.map((address) => (
                  <label key={address.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-mist bg-paper/90 p-3">
                    <input
                      type="radio"
                      name="addressId"
                      checked={selectedAddressId === address.id}
                      onChange={() => setSelectedAddressId(address.id)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-ink">
                        {address.label}
                        {address.isDefault ? <span className="ml-2 rounded-full bg-forest px-2 py-0.5 text-xs text-canvas">Default</span> : null}
                      </span>
                      <span className="block text-graphite">{address.line1}</span>
                      {address.line2 ? <span className="block text-graphite">{address.line2}</span> : null}
                      <span className="block text-graphite">{address.city}, {address.state} {address.postalCode}</span>
                      <span className="block text-graphite">{address.country}</span>
                      <span className="block text-graphite">Phone: {address.phone}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <h2 className="mt-6 text-lg font-semibold">Payment Method</h2>
            <div className="mt-3 space-y-2 text-sm">
              {summary.onlinePaymentsEnabled ? (
                <>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={paymentMethod === "upi"} onChange={() => setPaymentMethod("upi")} /> UPI
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={paymentMethod === "card"} onChange={() => setPaymentMethod("card")} /> Card
                  </label>
                </>
              ) : (
                <p className="rounded-xl border border-mist bg-paper/90 px-3 py-2 text-graphite">
                  Online payments are paused right now. Checkout is available with Cash on Delivery only.
                </p>
              )}
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={paymentMethod === "cod"}
                  disabled={!summary.codEligibility.allowed}
                  onChange={() => setPaymentMethod("cod")}
                />
                Cash on Delivery
              </label>
              {!summary.codEligibility.allowed ? (
                <p className="text-xs text-graphite">COD unavailable above Rs {summary.codEligibility.maxInr}.</p>
              ) : null}
              {!summary.onlinePaymentsEnabled && !summary.codEligibility.allowed ? (
                <p className="text-xs text-terracotta">This order cannot be placed right now because COD is unavailable for this total and online payments are paused.</p>
              ) : null}
            </div>
          </div>

          <aside className="rounded-xl border border-mist bg-gradient-to-br from-paper to-mist-light/70 p-4">
            <h3 className="text-base font-semibold">Order Summary</h3>
            <div className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>Rs {summary.totals.subtotalInr}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>Rs {summary.totals.taxTotalInr}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span>Rs {summary.totals.grandTotalInr}</span>
              </div>
            </div>
            <button
              type="button"
              disabled={!summary.canCheckout || placing || addresses.length === 0 || !selectedAddressId}
              onClick={() => void placeOrder()}
              className="mt-4 w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:cursor-not-allowed disabled:opacity-50"
            >
              {placing ? "Placing Order..." : "Place Order"}
            </button>
          </aside>
        </section>
      ) : null}
    </main>
  );
}