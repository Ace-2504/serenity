import Link from "next/link";
import { PurchaseActions } from "@/components/admin/purchase-actions";
import { PurchaseForm } from "@/components/admin/purchase-form";
import { requireServerRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { linkedWebsiteSource } from "@/server/adapters/website/queue";
import { billTotalPaise } from "@/server/purchases/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Purchases · Owner console" };

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/** ERP purchases: stock comes in on a supplier's bill, with its cost. */
export default async function PurchasesPage() {
  const session = await requireServerRole(["owner_admin", "catalog_manager"]);
  const [suppliers, variants, bills, linked] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.productVariant.findMany({
      where: { isActive: true },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, costPricePaise: true, product: { select: { title: true, gstPercent: true } }, inventory: { select: { stockOnHand: true } } }
    }),
    prisma.purchaseBill.findMany({ orderBy: [{ billDate: "desc" }, { createdAt: "desc" }], take: 50, include: { supplier: { select: { name: true } }, lines: true } }),
    linkedWebsiteSource()
  ]);
  const owner = session.roles.includes("owner_admin");

  return (
    <main className="w-full px-4 pb-14 pt-8 md:px-8 xl:px-12">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">ERP</p>
        <h1 className="mt-1 font-display text-4xl">Purchases</h1>
        <p className="mt-2 max-w-2xl text-sm text-graphite">
          Record each supplier&apos;s bill when stock arrives. The quantities are added to the shop&apos;s stock, each product&apos;s cost becomes the bill&apos;s rate, and
          the bill goes into the books as a purchase and what you owe the supplier.
        </p>
        {!linked && (
          <p className="mt-3 max-w-2xl rounded-lg border border-mustard bg-mustard/20 px-3 py-2 text-sm">
            The website is not linked to a business yet, so bills update stock but not the books.{" "}
            {owner && (
              <Link href="/admin/erp/imports" className="underline">
                Link it on Data &amp; connections
              </Link>
            )}
          </p>
        )}
      </header>

      <section className="mb-6 rounded-2xl border border-mist bg-canvas p-5">
        <h2 className="mb-3 font-display text-2xl">Record a bill</h2>
        {variants.length === 0 ? (
          <p className="text-sm text-graphite">
            Add products on <Link href="/admin/inventory" className="underline">Products &amp; stock</Link> first.
          </p>
        ) : (
          <PurchaseForm
            suppliers={suppliers}
            variants={variants.map((v) => ({ id: v.id, label: `${v.product.title} · ${v.sku} (in stock ${v.inventory?.stockOnHand ?? 0})`, gstPercent: v.product.gstPercent, costPaise: v.costPricePaise }))}
          />
        )}
      </section>

      <section className="rounded-2xl border border-mist bg-canvas p-5">
        <h2 className="mb-3 font-display text-2xl">Recent bills</h2>
        {bills.length === 0 ? (
          <p className="text-sm text-graphite">No bills recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Supplier</th>
                  <th className="py-2 pr-3">Bill</th>
                  <th className="py-2 pr-3 text-right">Units</th>
                  <th className="py-2 pr-3 text-right">Total with GST</th>
                  <th className="py-2 pr-3">Paid</th>
                  {owner && <th className="py-2" />}
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t border-mist/70">
                    <td className="py-2 pr-3">{day.format(b.billDate)}</td>
                    <td className="py-2 pr-3">{b.supplier.name}</td>
                    <td className="py-2 pr-3">{b.billNumber}</td>
                    <td className="py-2 pr-3 text-right">{b.lines.reduce((s, l) => s + l.quantity, 0)}</td>
                    <td className="py-2 pr-3 text-right">{inr(billTotalPaise(b.lines))}</td>
                    <td className="py-2 pr-3">{b.paidOn ? day.format(b.paidOn) : <span className="text-terracotta">Owed</span>}</td>
                    {owner && (
                      <td className="py-2">
                        <PurchaseActions billId={b.id} paid={!!b.paidOn} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
