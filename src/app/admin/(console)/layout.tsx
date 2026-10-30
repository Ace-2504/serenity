import { redirect } from "next/navigation";
import Link from "next/link";
import { ConsoleNav, type NavGroup } from "@/components/admin/console-nav";
import { getServerSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRazorpayEnabled } from "@/lib/payment-provider";

export const dynamic = "force-dynamic";

const SHOP_ROLES = ["owner_admin", "catalog_manager", "order_operations"];

/**
 * The owner console: one admin area for the shop. Shop staff see the shop's operations; the
 * owner (and anyone a business has made a member) also sees the ERP and CRM, which read the
 * books the shop feeds.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = getServerSession();
  if (!session) redirect("/admin/login");
  const shopStaff = session.roles.some((r) => SHOP_ROLES.includes(r));
  const isMember = (await prisma.membership.count({ where: { userId: session.userId } })) > 0;
  const books = session.roles.includes("owner_admin") || isMember;
  if (!shopStaff && !books) redirect("/admin/login?error=invalid");

  const groups: NavGroup[] = [];
  if (shopStaff) {
    groups.push({
      title: "Shop",
      links: [
        { href: "/admin", label: "Dashboard" },
        { href: "/admin/inventory", label: "Products & stock" },
        ...(isRazorpayEnabled() ? [{ href: "/admin/payments", label: "Payments" }] : [])
      ]
    });
  }
  if (books) {
    groups.push(
      {
        title: "ERP",
        note: "Your books",
        links: [
          { href: "/admin/erp", label: "Overview" },
          { href: "/admin/erp/purchases", label: "Purchases" },
          { href: "/admin/erp/profitability", label: "Profitability" },
          { href: "/admin/erp/channels", label: "Sales channels" },
          { href: "/admin/erp/inventory", label: "Stock analysis" },
          { href: "/admin/erp/cash", label: "Cash & dues" },
          { href: "/admin/erp/predictions", label: "Predictions" },
          { href: "/admin/erp/imports", label: "Data & connections" }
        ]
      },
      {
        title: "CRM",
        note: "Your customers",
        links: [
          { href: "/admin/crm/customers", label: "Customers" },
          { href: "/admin/crm/campaigns", label: "Campaigns" }
        ]
      },
      {
        title: "Help & settings",
        links: [
          { href: "/admin/erp/assistant", label: "Ask" },
          { href: "/admin/erp/metrics", label: "Definitions" },
          { href: "/admin/erp/business", label: "Business" },
          { href: "/admin/erp/system", label: "System" }
        ]
      }
    );
  }

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-mist bg-canvas/95 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center justify-between gap-3 lg:block">
          <Link href="/admin" className="block min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Paper Serenity</p>
            <p className="font-display text-xl text-ink">Owner console</p>
          </Link>
          <div className="flex items-center gap-2 lg:mt-3">
            <Link href="/" className="rounded-full border border-mist px-3 py-1 text-xs font-semibold hover:border-ink">
              View shop
            </Link>
            <form action="/api/auth/logout" method="post">
              <input type="hidden" name="next" value="/admin/login" />
              <button type="submit" className="rounded-full border border-mist px-3 py-1 text-xs font-semibold hover:border-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
        <ConsoleNav groups={groups} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
