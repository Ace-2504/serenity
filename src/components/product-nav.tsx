"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SHOP_PATHS = ["/shop", "/c", "/p", "/cart", "/checkout", "/account", "/bestsellers", "/clearance", "/bulk-orders", "/register", "/admin"];

/** The product's own top bar (landing page, sign-up, sign-in, the reports). The shop keeps its header. */
export default function ProductNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  if (SHOP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const inApp = pathname.startsWith("/bi");

  return (
    <header className="border-b border-mist/70 bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
        <Link href={signedIn ? "/bi" : "/"} className="flex items-baseline gap-2" aria-label="Serenity BI home">
          <span className="font-display text-xl text-ink">Serenity</span>
          <span className="rounded bg-forest px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-canvas">BI</span>
        </Link>
        <nav aria-label="Account" className="flex flex-wrap items-center gap-1 text-sm font-medium">
          {!inApp && (
            <Link href="/privacy" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
              Your data
            </Link>
          )}
          {signedIn ? (
            <>
              {!inApp && (
                <Link href="/bi" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
                  Your reports
                </Link>
              )}
              <form action="/api/auth/logout" method="post">
                <input type="hidden" name="next" value="/" />
                <button type="submit" className="rounded-full border border-mist px-3 py-1.5 text-graphite hover:border-ink hover:text-ink">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-3 py-1.5 text-graphite hover:bg-paper hover:text-ink">
                Sign in
              </Link>
              <Link href="/signup" className="rounded-full bg-ink px-4 py-1.5 font-semibold text-canvas hover:bg-forest">
                Create your account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
