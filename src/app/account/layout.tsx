import Link from "next/link";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen w-full px-4 pb-16 pt-8 md:px-8 xl:px-12">
      <header className="mb-6 rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#edf7f8] to-paper p-5 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-graphite">My Account</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-forest">Paper Serenity Stationery Hub</p>
          <h1 className="font-display text-4xl">Customer Dashboard</h1>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-4">
          <nav className="space-y-2 text-sm">
            <Link href="/account" className="block rounded-lg px-3 py-2 font-semibold hover:bg-paper">
              Addresses
            </Link>
            <Link href="/account/password" className="block rounded-lg px-3 py-2 font-semibold hover:bg-paper">
              Password
            </Link>
            <Link href="/account/orders" className="block rounded-lg px-3 py-2 font-semibold hover:bg-paper">
              Orders
            </Link>
            <Link href="/cart" className="block rounded-lg px-3 py-2 hover:bg-paper">
              Cart
            </Link>
            <Link href="/checkout" className="block rounded-lg px-3 py-2 hover:bg-paper">
              Checkout
            </Link>
          </nav>
        </aside>
        <section>{children}</section>
      </div>
    </main>
  );
}