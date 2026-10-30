import type { Route } from "next";
import Link from "next/link";
import { formatDate } from "@/components/bi/format";
import type { TenantDb } from "@/server/db/tenant";

/** The CRM's address book: every named customer, including shop accounts that have not bought yet. */
export async function CustomerDirectory({ db, q, lastPurchase }: { db: TenantDb; q: string; lastPurchase: Map<string, string> }) {
  const term = q.trim();
  const parties = await db.party.findMany({
    where: {
      kind: { in: ["customer", "both"] },
      anonymousBuyers: false,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }, { phone: { contains: term } }] } : {})
    },
    orderBy: term ? { name: "asc" } : { createdAt: "desc" },
    take: 25,
    select: { id: true, name: true, email: true, phone: true, city: true }
  });
  const consents = await db.contactConsent.findMany({ where: { channel: "email", partyId: { in: parties.map((p) => p.id) } }, orderBy: { recordedAt: "desc" }, select: { partyId: true, status: true } });
  const consent = new Map<string, string>();
  for (const c of consents) if (!consent.has(c.partyId)) consent.set(c.partyId, c.status);

  return (
    <section className="rounded-xl2 border border-mist bg-canvas p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl">Customer directory</h2>
          <p className="mt-1 text-sm text-graphite">{term ? `Matching “${term}”` : "Newest first"}, up to 25. Includes shop accounts that have not bought yet.</p>
        </div>
        <form action="/admin/crm/customers" method="get" className="flex gap-2">
          <label htmlFor="customer-search" className="sr-only">
            Find a customer
          </label>
          <input id="customer-search" name="q" defaultValue={term} placeholder="Name, email or phone" className="min-w-0 rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm" />
          <button className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper">Find</button>
        </form>
      </div>
      {parties.length === 0 ? (
        <p className="mt-3 text-sm text-graphite">No customers found.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-graphite">
              <tr>
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Contact</th>
                <th className="py-2 pr-3">City</th>
                <th className="py-2 pr-3">Last bought</th>
                <th className="py-2">Offers by email</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="border-t border-mist-light">
                  <td className="py-1.5 pr-3">
                    <Link href={`/admin/crm/customers/${p.id}` as Route} className="font-semibold hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="break-all py-1.5 pr-3 text-graphite">{[p.email, p.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-1.5 pr-3">{p.city || "—"}</td>
                  <td className="py-1.5 pr-3">{lastPurchase.has(p.id) ? formatDate(lastPurchase.get(p.id)!) : "Not yet"}</td>
                  <td className="py-1.5">{consent.get(p.id) === "granted" ? "Agreed" : consent.get(p.id) === "revoked" ? "Unsubscribed" : "Not asked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
