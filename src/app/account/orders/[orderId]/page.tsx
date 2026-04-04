"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  grandTotalInr: number;
  subtotalInr: number;
  taxTotalInr: number;
  shippingTotalInr: number;
  placedAt: string;
  items: Array<{
    id: string;
    titleSnapshot: string;
    skuSnapshot: string;
    quantity: number;
    unitPriceInr: number;
    taxAmountInr: number;
    lineTotalInr: number;
  }>;
};

export default function OrderDetailPage({ params }: { params: { orderId: string } }) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOrder() {
      const response = await fetch(`/api/orders/${params.orderId}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        setError(data.message ?? "Unable to load order.");
        setLoading(false);
        return;
      }

      const data = (await response.json()) as OrderDetail;
      setOrder(data);
      setLoading(false);
    }

    void loadOrder();
  }, [params.orderId]);

  return (
    <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Order Details</h2>
        <Link href="/account/orders" className="text-sm font-semibold text-forest hover:underline">
          Back to Orders
        </Link>
      </div>

      {loading ? <p className="text-sm text-graphite">Loading order...</p> : null}
      {error ? <p className="rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">{error}</p> : null}

      {order ? (
        <>
          <div className="mb-4 rounded-xl border border-mist bg-paper/90 p-4 text-sm">
            <p>
              <span className="font-semibold">Order:</span> {order.orderNumber}
            </p>
            <p className="mt-1">
              <span className="font-semibold">Status:</span> {order.status}
            </p>
            <p className="mt-1">
              <span className="font-semibold">Payment:</span> {order.paymentStatus}
            </p>
            <p className="mt-1">
              <span className="font-semibold">Placed:</span> {new Date(order.placedAt).toLocaleString()}
            </p>
          </div>

          <div className="space-y-3">
            {order.items.map((item) => (
              <article key={item.id} className="rounded-xl border border-mist p-4">
                <h3 className="font-semibold">{item.titleSnapshot}</h3>
                <p className="text-xs uppercase tracking-wide text-graphite">{item.skuSnapshot}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <p>Qty: {item.quantity}</p>
                  <p>Unit: ₹{item.unitPriceInr}</p>
                  <p>Tax: ₹{item.taxAmountInr}</p>
                  <p className="font-semibold">Line Total: ₹{item.lineTotalInr}</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-mist bg-paper/90 p-4 text-sm">
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>₹{order.subtotalInr}</span>
            </p>
            <p className="mt-1 flex justify-between">
              <span>Tax</span>
              <span>₹{order.taxTotalInr}</span>
            </p>
            <p className="mt-1 flex justify-between">
              <span>Shipping</span>
              <span>₹{order.shippingTotalInr}</span>
            </p>
            <p className="mt-2 flex justify-between text-base font-semibold">
              <span>Total</span>
              <span>₹{order.grandTotalInr}</span>
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}