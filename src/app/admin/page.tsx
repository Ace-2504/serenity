import Link from "next/link";
import { requireServerRole } from "@/lib/auth";
import { isRazorpayEnabled } from "@/lib/payment-provider";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  await requireServerRole(["owner_admin", "catalog_manager", "order_operations"]);
  const razorpayEnabled = isRazorpayEnabled();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [ordersToday, pendingPack, lowStockAlerts, activeCoupons, orders] = await Promise.all([
    prisma.order.count({ where: { placedAt: { gte: startOfDay } } }),
    prisma.order.count({ where: { status: { in: ["confirmed", "packed"] } } }),
    prisma.inventoryItem.count({ where: { stockOnHand: { lte: 10 } } }),
    prisma.coupon.count({ where: { status: "active" } }),
    prisma.order.findMany({
      orderBy: { placedAt: "desc" },
      take: 10,
      include: {
        user: {
          select: {
            email: true,
            profile: { select: { firstName: true, lastName: true } }
          }
        }
      }
    })
  ]);

  const stats = [
    { label: "Orders Today", value: String(ordersToday) },
    { label: "Pending Pack", value: String(pendingPack) },
    { label: "Low Stock Alerts", value: String(lowStockAlerts) },
    { label: "Active Coupons", value: String(activeCoupons) }
  ];

  const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  return (
    <main className="min-h-screen w-full px-4 pb-14 pt-8 md:px-8 xl:px-12">
      <header className="reveal-in relative mb-6 overflow-hidden rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#eff7f8] to-paper p-5 shadow-panel">
        <div className="pointer-events-none absolute -right-14 -top-14 h-44 w-44 rounded-full bg-sage/20 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Owner Console</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Paper Serenity Stationery Hub</p>
        <h1 className="mt-2 font-display text-4xl">Admin Operations Dashboard</h1>
        <p className="mt-2 text-sm text-graphite">A calm control center for catalog, orders, inventory, payments, promotions, and support workflows.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/" className="rounded-full border border-mist px-4 py-2 text-sm font-semibold hover:border-ink hover:bg-paper">
            Customer Dashboard
          </Link>
          <Link href="/admin/inventory" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Inventory Management
          </Link>
          {razorpayEnabled ? (
            <Link href="/admin/payments" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
              Payment Reconciliation
            </Link>
          ) : (
            <span className="rounded-full border border-mist bg-paper px-4 py-2 text-sm font-semibold text-graphite">
              Razorpay Paused
            </span>
          )}
        </div>
      </header>

      <section className="reveal-in reveal-delay-1 mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="rounded-xl2 border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-4">
            <p className="text-xs uppercase tracking-wide text-graphite">{stat.label}</p>
            <p className="mt-2 text-3xl font-bold text-ink">{stat.value}</p>
          </article>
        ))}
      </section>

      <section className="reveal-in reveal-delay-2 rounded-2xl border border-mist bg-canvas/90 p-5 backdrop-blur-sm">
        <h2 className="mb-4 text-xl font-semibold">Priority Order Queue</h2>
        <div className="overflow-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-mist text-graphite">
                <th className="py-2">Order</th>
                <th className="py-2">Customer</th>
                <th className="py-2">Status</th>
                <th className="py-2">Value</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-mist/60">
                  <td className="py-3">
                    <p className="font-semibold">{order.orderNumber}</p>
                    <p className="text-xs text-graphite">Placed: {dateTimeFormatter.format(order.placedAt)}</p>
                  </td>
                  <td className="py-3">
                    {order.user.profile && order.user.profile.firstName
                      ? `${order.user.profile.firstName} ${order.user.profile.lastName}`.trim()
                      : order.user.email}
                  </td>
                  <td className="py-3">
                    <span className="rounded-full bg-paper px-2 py-1 text-xs font-semibold uppercase tracking-wide">
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3">₹{order.grandTotalInr}</td>
                  <td className="py-3">
                    <Link
                      href={`/admin/orders/${order.id}`}
                      className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold text-ink hover:border-forest hover:bg-forest hover:text-canvas"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}