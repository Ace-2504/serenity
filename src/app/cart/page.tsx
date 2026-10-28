"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getProductImage } from "@/lib/product-images";

type CartItem = {
  id: string;
  variantId: string;
  productTitle: string;
  sku: string;
  quantity: number;
  unitPriceInr: number;
  lineTotalInr: number;
};

type CartResponse = {
  items: CartItem[];
  summary: {
    subtotalInr: number;
    itemCount: number;
  };
};

export default function CartPage() {
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const loadCart = useCallback(async () => {
    setLoading(true);
    setError("");

    const response = await fetch("/api/cart", { cache: "no-store" });
    if (!response.ok) {
      setError("Please login to view your cart.");
      setLoading(false);
      return;
    }

    const data = (await response.json()) as CartResponse;
    setCart(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCart();
  }, [loadCart]);

  const hasItems = useMemo(() => (cart?.items.length ?? 0) > 0, [cart]);

  async function updateQuantity(itemId: string, quantity: number) {
    if (quantity < 1) return;

    const response = await fetch(`/api/cart/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Failed to update quantity.");
      return;
    }

    await loadCart();
  }

  async function removeItem(itemId: string) {
    const response = await fetch(`/api/cart/items/${itemId}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Failed to remove item.");
      return;
    }
    await loadCart();
  }

  return (
    <main className="min-h-screen w-full bg-canvas px-4 pb-16 pt-6 md:px-8 xl:px-12">
      <header className="mb-8 rounded-3xl border border-mist/70 bg-gradient-to-br from-[#edf8f9] via-[#e2f0f3] to-[#d6e5ec] p-6 md:p-8">
        <p className="inline-flex rounded-full border border-forest/30 bg-forest/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-forest">
          Shopping Cart
        </p>
        <h1 className="mt-3 font-display text-4xl text-ink md:text-5xl">Review Your Cart</h1>
        <p className="mt-2 text-sm text-graphite">Adjust quantities, review totals, and continue to secure checkout.</p>
      </header>

      {loading ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-mist bg-canvas">
          <p className="text-sm text-graphite">Loading your cart…</p>
        </div>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-xl border border-terracotta bg-[#fce7e2] px-4 py-3 text-sm text-terracotta">{error}</p>
      ) : null}

      {!loading && !hasItems ? (
        <section className="rounded-2xl border border-mist bg-canvas p-10 text-center">
          <p className="font-display text-2xl">Your cart is empty</p>
          <p className="mt-2 text-sm text-graphite">Browse the store and add items to get started.</p>
          <Link href="/" className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas">
            Continue Shopping
          </Link>
        </section>
      ) : null}

      {hasItems && cart ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          {/* Items */}
          <section className="space-y-3">
            {cart.items.map((item) => {
              const image = getProductImage({ sku: item.sku, title: item.productTitle });

              return (
              <article key={item.id} className="flex gap-4 rounded-2xl border border-mist bg-canvas p-4 shadow-sm">
                {/* mini image */}
                <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-paper to-mist/45">
                  <Image
                    src={image.src}
                    alt={image.alt}
                    fill
                    sizes="64px"
                    className={`${image.position} object-contain p-1`}
                  />
                </div>

                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold leading-snug">{item.productTitle}</p>
                      <p className="text-xs text-graphite">{item.sku}</p>
                    </div>
                    <button
                      onClick={() => void removeItem(item.id)}
                      type="button"
                      className="text-xs font-medium text-graphite hover:text-terracotta"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-mist text-lg font-semibold hover:border-ink"
                      >
                        -
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                        type="button"
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-mist text-lg font-semibold hover:border-ink"
                      >
                        +
                      </button>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-graphite">Rs {item.unitPriceInr} each</p>
                      <p className="font-bold text-ink">Rs {item.lineTotalInr}</p>
                    </div>
                  </div>
                </div>
              </article>
            );})}
          </section>

          {/* Summary */}
          <aside className="h-fit rounded-2xl border border-mist bg-gradient-to-br from-paper to-mist-light/60 p-5 shadow-sm">
            <h2 className="font-display text-xl">Order Summary</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between text-graphite">
                <span>{cart.summary.itemCount} {cart.summary.itemCount === 1 ? "item" : "items"}</span>
                <span>Rs {cart.summary.subtotalInr}</span>
              </div>
              <div className="flex justify-between text-graphite">
                <span>Shipping</span>
                <span className="text-forest font-medium">Free above Rs 499</span>
              </div>
              <div className="border-t border-mist pt-2 flex justify-between font-bold">
                <span>Subtotal</span>
                <span>Rs {cart.summary.subtotalInr}</span>
              </div>
            </div>
            <Link
              href="/checkout"
              className="mt-5 block rounded-full bg-ink px-4 py-3 text-center text-sm font-semibold text-canvas hover:bg-forest"
            >
              Proceed to Checkout
            </Link>
            <Link
              href="/"
              className="mt-2 block rounded-full border border-mist px-4 py-2.5 text-center text-sm font-medium text-graphite hover:border-ink hover:text-ink"
            >
              Continue Shopping
            </Link>

            <div className="mt-4 rounded-xl border border-mist/70 bg-canvas/70 p-3 text-xs text-graphite">
              Secure payment processing with invoice-ready order details.
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}