import Link from "next/link";
import { notFound } from "next/navigation";
import { requireServerRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminOrderDetailPage({ params }: { params: { orderId: string } }) {
  await requireServerRole(["owner_admin", "catalog_manager", "order_operations"]);

  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    include: {
      user: {
        select: {
          email: true,
          profile: { select: { firstName: true, lastName: true } }
        }
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          titleSnapshot: true,
          skuSnapshot: true,
          quantity: true,
          unitPriceInr: true,
          taxPercent: true,
          taxAmountInr: true,
          lineTotalInr: true
        }
      }
    }
  });

  if (!order) {
    notFound();
  }

  const customerName = order.user.profile?.firstName
    ? `${order.user.profile.firstName} ${order.user.profile.lastName}`.trim()
    : order.user.email;

  return (
    <main className="min-h-screen w-full px-4 pb-14 pt-8 md:px-8 xl:px-12">
      <header className="mb-6 rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#eff7f8] to-paper p-5 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Admin Order View</p>
        <h1 className="mt-2 font-display text-4xl">Order {order.orderNumber}</h1>
        <p className="mt-2 text-sm text-graphite">Placed: {new Date(order.placedAt).toLocaleString("en-IN")}</p>
        <div className="mt-4">
          <Link href="/admin" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Back to Dashboard
          </Link>
        </div>
      </header>

      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-mist bg-canvas p-5">
          <h2 className="text-lg font-semibold">Customer</h2>
          <p className="mt-2 text-sm text-graphite">{customerName}</p>
          <p className="mt-1 text-sm text-graphite">{order.user.email}</p>
        </article>

        <article className="rounded-2xl border border-mist bg-canvas p-5">
          <h2 className="text-lg font-semibold">Order Summary</h2>
          <div className="mt-2 space-y-1 text-sm text-graphite">
            <p>Status: <span className="font-semibold uppercase text-ink">{order.status}</span></p>
            <p>Payment Method: <span className="font-semibold uppercase text-ink">{order.paymentMethod}</span></p>
            <p>Payment Status: <span className="font-semibold uppercase text-ink">{order.paymentStatus}</span></p>
          </div>
          <div className="mt-3 border-t border-mist pt-3 text-sm">
            <p className="flex justify-between"><span>Subtotal</span><span>Rs {order.subtotalInr}</span></p>
            <p className="mt-1 flex justify-between"><span>Tax</span><span>Rs {order.taxTotalInr}</span></p>
            <p className="mt-1 flex justify-between"><span>Shipping</span><span>Rs {order.shippingTotalInr}</span></p>
            <p className="mt-1 flex justify-between"><span>Discount</span><span>Rs {order.discountTotalInr}</span></p>
            <p className="mt-2 flex justify-between text-base font-semibold text-ink"><span>Grand Total</span><span>Rs {order.grandTotalInr}</span></p>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-mist bg-canvas/90 p-5">
        <h2 className="mb-4 text-xl font-semibold">Order Contents</h2>
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-mist text-graphite">
                <th className="py-2">Product</th>
                <th className="py-2">SKU</th>
                <th className="py-2">Qty</th>
                <th className="py-2">Unit</th>
                <th className="py-2">Tax %</th>
                <th className="py-2">Tax</th>
                <th className="py-2">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-mist/60">
                  <td className="py-3 font-semibold">{item.titleSnapshot}</td>
                  <td className="py-3">{item.skuSnapshot}</td>
                  <td className="py-3">{item.quantity}</td>
                  <td className="py-3">Rs {item.unitPriceInr}</td>
                  <td className="py-3">{item.taxPercent}%</td>
                  <td className="py-3">Rs {item.taxAmountInr}</td>
                  <td className="py-3 font-semibold">Rs {item.lineTotalInr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
