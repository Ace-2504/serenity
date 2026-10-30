import type { Route } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { linkedWebsiteSource } from "@/server/adapters/website/queue";
import { forTenant } from "@/server/db/tenant";
import { billTotalPaise } from "@/server/purchases/service";

const dateTime = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const inr = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** The dashboard's view into the ERP and CRM: what the books say, read from the linked business. */
export async function BooksSummary() {
  const source = await linkedWebsiteSource();
  const owedBills = await prisma.purchaseBill.findMany({ where: { paidOn: null }, select: { lines: { select: { quantity: true, unitCostPaise: true, gstPercent: true } } } });
  const owed = owedBills.reduce((s, b) => s + billTotalPaise(b.lines), 0);

  if (!source) {
    return (
      <section className="mb-6 rounded-2xl border border-mustard bg-mustard/15 p-5">
        <h2 className="text-xl font-semibold">ERP &amp; CRM</h2>
        <p className="mt-1 text-sm">
          The website is not linked to the books yet, so orders, customers and purchases do not reach the ERP and CRM.{" "}
          <Link href="/admin/erp/imports" className="font-semibold underline">
            Link it on Data &amp; connections
          </Link>
          .
        </p>
      </section>
    );
  }

  const db = forTenant(source.tenantId);
  const [tenant, sourceRow, open, top, customers, consenting] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: source.tenantId }, select: { name: true } }),
    db.dataSource.findFirstOrThrow({ where: { id: source.id }, select: { lastSuccessfulSyncAt: true } }),
    db.finding.count({ where: { status: "open" } }),
    db.finding.findMany({ where: { status: "open" }, orderBy: [{ impactInr: { sort: "desc", nulls: "last" } }], take: 3, select: { id: true, title: true } }),
    db.party.count({ where: { dataSourceId: source.id, kind: { in: ["customer", "both"] } } }),
    db.contactConsent.findMany({ where: { channel: "email" }, orderBy: { recordedAt: "desc" }, select: { partyId: true, status: true } })
  ]);
  const latest = new Map<string, string>();
  for (const c of consenting) if (!latest.has(c.partyId)) latest.set(c.partyId, c.status);
  const reachable = [...latest.values()].filter((s) => s === "granted").length;

  const tiles = [
    { label: "Needs a decision", value: String(open), href: "/admin/erp" },
    { label: "Customers in the CRM", value: String(customers), href: "/admin/crm/customers" },
    { label: "Agreed to offers by email", value: String(reachable), href: "/admin/crm/campaigns" },
    { label: "Owed to suppliers", value: inr(owed), href: "/admin/erp/purchases" }
  ];

  return (
    <section className="mb-6 rounded-2xl border border-mist bg-canvas/90 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">ERP &amp; CRM: {tenant.name}</h2>
        <p className="text-xs text-graphite">Books last updated from the website {sourceRow.lastSuccessfulSyncAt ? dateTime.format(sourceRow.lastSuccessfulSyncAt) : "not yet"}</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href as Route} className="rounded-xl2 border border-mist p-4 hover:border-ink">
            <p className="text-xs uppercase tracking-wide text-graphite">{t.label}</p>
            <p className="mt-2 text-2xl font-bold text-ink">{t.value}</p>
          </Link>
        ))}
      </div>
      {top.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {top.map((f) => (
            <li key={f.id}>
              <Link href={`/admin/erp/findings/${f.id}` as Route} className="hover:underline">
                {f.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
