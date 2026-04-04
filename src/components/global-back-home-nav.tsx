"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavSession = {
  userId: string;
  email: string;
  roles: Array<"owner_admin" | "catalog_manager" | "order_operations" | "customer">;
  iat: number;
};

export default function GlobalBackHomeNav({ session }: { session: NavSession | null }) {
  const pathname = usePathname();

  if (!pathname || pathname === "/" || pathname.startsWith("/admin")) {
    return null;
  }

  const isAuth = pathname === "/login" || pathname === "/register";
  const isAdmin = !!session?.roles?.some((role) => ["owner_admin", "catalog_manager", "order_operations"].includes(role));

  return (
    <header className="sticky top-0 z-30 border-b border-mist/70 bg-canvas/95 backdrop-blur-xl shadow-sm">
      <div className="flex w-full flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-8 xl:px-12">
        <div className="flex items-center gap-3">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-ink to-forest text-xs font-black text-canvas shadow-sm transition group-hover:scale-105">
              P
            </span>
            <span className="leading-tight">
              <span className="block font-display text-base leading-none text-ink md:text-lg">Paper Serenity</span>
              <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-graphite/85 md:block">
                Stationery Hub
              </span>
            </span>
          </Link>
          <span className="hidden rounded-full border border-forest/20 bg-forest/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-forest md:inline-flex">
            Offers live
          </span>
        </div>

        {!isAuth ? (
          <nav className="flex items-center gap-1 text-sm font-medium">
            <Link
              href="/c/notebooks-and-journals"
              className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink"
            >
              Collections
            </Link>
            <Link
              href="/c/pens-and-writing"
              className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink"
            >
              Pens and Markers
            </Link>
            <Link
              href="/cart"
              className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink"
            >
              Cart
            </Link>

            {session ? (
              <>
                {isAdmin ? (
                  <Link
                    href="/admin"
                    className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink"
                  >
                    Admin
                  </Link>
                ) : null}
                <Link
                  href="/account"
                  className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink"
                >
                  Account
                </Link>
                <form action="/api/auth/logout" method="post">
                  <input type="hidden" name="next" value="/" />
                  <button
                    type="submit"
                    className="rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink"
                  >
                    Log out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="rounded-full bg-ink px-3 py-1.5 text-canvas hover:bg-terracotta"
                >
                  Sign up
                </Link>
              </>
            )}

            <Link
              href="/"
              className="ml-1 rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink"
            >
              Back Home
            </Link>
          </nav>
        ) : (
          <Link
            href="/"
            className="rounded-full border border-mist px-3 py-1.5 text-sm font-medium text-graphite hover:border-ink hover:text-ink"
          >
            Back Home
          </Link>
        )}
      </div>
    </header>
  );
}