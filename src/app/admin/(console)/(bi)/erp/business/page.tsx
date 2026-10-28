import Link from "next/link";
import { notFound } from "next/navigation";
import { getDomainPack } from "@/domain/packs";
import { formatDate } from "@/components/bi/format";
import { DeleteBusiness } from "@/components/bi/delete-business";
import { prisma } from "@/lib/prisma";
import { getBiContext } from "@/server/bi/context";

export const metadata = { title: "Business · Owner console" };

const ROLE_LABELS = { owner_admin: "Owner", accountant: "Accountant", analyst: "Analyst" } as const;

export default async function BusinessPage() {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  // Members are listed from the membership table, which is keyed by business.
  const [tenant, members, imports] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: bi.tenant.id }, select: { createdAt: true } }),
    prisma.membership.findMany({ where: { tenantId: bi.tenant.id }, include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    bi.db.importBatch.count({ where: { status: "committed" } })
  ]);

  return (
    <div className="grid max-w-3xl gap-6">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">This business</h2>
        <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
          <dt className="text-graphite">Name</dt>
          <dd>{bi.tenant.name}</dd>
          <dt className="text-graphite">Trade</dt>
          <dd>{getDomainPack(bi.tenant.domainPack).label}</dd>
          <dt className="text-graphite">Created</dt>
          <dd>{formatDate(tenant.createdAt)}</dd>
          <dt className="text-graphite">Saved imports</dt>
          <dd>{imports}</dd>
          <dt className="text-graphite">Your role</dt>
          <dd>{ROLE_LABELS[bi.role]}</dd>
        </dl>
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">People with access</h2>
        <ul className="mt-3 divide-y divide-mist text-sm">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="min-w-0 break-all">{m.user.email}</span>
              <span className="text-graphite">{ROLE_LABELS[m.role]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-graphite">Inviting an accountant or analyst from this page is not built yet.</p>
      </section>

      {bi.role === "owner_admin" && (
        <section className="rounded-xl2 border border-terracotta/60 bg-canvas p-5">
          <h2 className="font-display text-2xl">Delete this business</h2>
          <p className="mt-2 text-sm text-graphite">
            Removes the business and everything imported into it: vouchers, stock, customers, findings, campaigns and their outbox, predictions and the import history. It
            cannot be undone. Your account stays, and so do your other businesses. Backups taken before the deletion still contain the data until they expire.{" "}
            <Link href="/admin/erp/data" className="underline">
              How data is handled
            </Link>
            .
          </p>
          <div className="mt-4">
            <DeleteBusiness tenantId={bi.tenant.id} name={bi.tenant.name} />
          </div>
        </section>
      )}
    </div>
  );
}
