import type { Route } from "next";
import Link from "next/link";
import { safeNextPath } from "@/server/security/rate-limit";

const SHOP_PATHS = ["/shop", "/c/", "/p/", "/cart", "/checkout", "/account", "/bestsellers", "/clearance", "/bulk-orders"];

export const metadata = { title: "Sign in · Serenity BI" };

export default function LoginPage({ searchParams }: { searchParams?: { error?: string; next?: string } }) {
  const next = safeNextPath(searchParams?.next || "/bi");
  const forShop = SHOP_PATHS.some((p) => next.startsWith(p));
  const error =
    searchParams?.error === "invalid" ? "That email and password don't match an account." : searchParams?.error === "rate_limited" ? "Too many sign-in attempts. Wait 15 minutes and try again." : null;

  return (
    <main className="flex min-h-[80vh] w-full items-center px-4 py-10 md:px-8">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-mist bg-canvas p-6 shadow-panel">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-forest">{forShop ? "Paper Serenity shop" : "Serenity BI"}</p>
        <h1 className="mt-2 font-display text-3xl">Sign in</h1>
        <p className="mt-2 text-sm text-graphite">{forShop ? "Sign in to your shop account." : "Sign in to see your business's reports."}</p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
            {error}
          </p>
        )}

        <form action="/api/auth/login" method="post" className="mt-5 space-y-4">
          <input type="hidden" name="next" value={next} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input id="login-email" type="email" name="email" required autoComplete="email" className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Password</span>
            <input id="login-password" type="password" name="password" required autoComplete="current-password" className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
          </label>
          <button className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest">Sign in</button>
        </form>

        <p className="mt-4 text-sm text-graphite">
          New here?{" "}
          <Link href={(forShop ? `/register?next=${encodeURIComponent(next)}` : "/signup") as Route} className="font-semibold text-ink hover:underline">
            {forShop ? "Create a shop account" : "Create your account"}
          </Link>
        </p>
      </section>
    </main>
  );
}
