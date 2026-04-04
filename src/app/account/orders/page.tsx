"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type OrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  grandTotalInr: number;
  placedAt: string;
};

export default function AccountOrdersPage() {
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOrders() {
      const response = await fetch("/api/orders", { cache: "no-store" });
      if (!response.ok) {
        setError("Please login to view orders.");
        setLoading(false);
        return;
      }

      const data = (await response.json()) as { items: OrderListItem[] };
      setItems(data.items);
      setLoading(false);
    }

    void loadOrders();
  }, []);

  return (
    <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Order History</h2>
      <p className="mt-1 text-sm text-graphite">Track your recent purchases and payment status.</p>

      {loading ? <p className="mt-4 text-sm text-graphite">Loading orders...</p> : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
          {error} <Link href="/login?next=/account/orders" className="font-semibold underline">Sign in</Link>
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <p className="mt-4 text-sm text-graphite">No orders yet. Place your first order from the storefront.</p>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="mt-4 overflow-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-mist text-graphite">
                <th className="py-2">Order</th>
                <th className="py-2">Status</th>
                <th className="py-2">Payment</th>
                <th className="py-2">Total</th>
                <th className="py-2">Placed</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id} className="border-b border-mist/60">
                  <td className="py-3 font-semibold">{order.orderNumber}</td>
                  <td className="py-3">
                    <span className="rounded-full bg-paper px-2 py-1 text-xs font-semibold uppercase tracking-wide">{order.status}</span>
                  </td>
                  <td className="py-3">{order.paymentStatus}</td>
                  <td className="py-3">₹{order.grandTotalInr}</td>
                  <td className="py-3">{new Date(order.placedAt).toLocaleString()}</td>
                  <td className="py-3">
                    <Link href={`/account/orders/${order.id}`} className="font-semibold text-forest hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}