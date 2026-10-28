"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavGroup = { title: string; note?: string; links: { href: string; label: string }[] };

/** The admin console's sections: the shop's operations, then the ERP and CRM built on its books. */
export function ConsoleNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? "";
  // The longest matching link is the active one, so /admin/erp/cash does not also light up /admin/erp.
  const active = groups
    .flatMap((g) => g.links)
    .filter((l) => pathname === l.href || (l.href !== "/admin" && l.href !== "/" && pathname.startsWith(`${l.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Admin" className="flex gap-4 overflow-x-auto pb-1 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
      {groups.map((group) => (
        <div key={group.title} className="min-w-max lg:min-w-0">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-graphite">{group.title}</p>
          {group.note && <p className="hidden px-3 text-xs text-graphite lg:block">{group.note}</p>}
          <ul className="mt-1 flex gap-1 lg:flex-col">
            {group.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href as Route}
                  aria-current={active === link.href ? "page" : undefined}
                  className={`block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                    active === link.href ? "bg-ink text-canvas" : "text-ink hover:bg-paper"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
