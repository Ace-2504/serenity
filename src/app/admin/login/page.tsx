export default function AdminLoginPage({
  searchParams
}: {
  searchParams?: { error?: string };
}) {
  const hasError = searchParams?.error === "invalid";

  return (
    <main className="flex min-h-screen w-full items-center px-4 py-10 md:px-8 xl:px-12">
      <div className="mx-auto w-full max-w-md">
        <section className="reveal-in w-full rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f3fafb] to-paper p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Owner Console</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Paper Serenity Stationery Hub</p>
        <h1 className="mt-2 font-display text-3xl">Admin Login</h1>
        <p className="mt-2 text-sm text-graphite">Sign in with an admin role account to access operations tools.</p>

        {hasError ? (
          <p className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
            Invalid admin credentials. Please try again.
          </p>
        ) : null}

        <form action="/api/admin/auth/login" method="post" className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email</span>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none ring-0 focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Password</span>
            <input
              type="password"
              name="password"
              required
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none ring-0 focus:border-ink"
            />
          </label>

          <button className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas">Sign in</button>
        </form>
        </section>
      </div>
    </main>
  );
}