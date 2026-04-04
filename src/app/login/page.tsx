import Link from "next/link";

export default function LoginPage({
  searchParams
}: {
  searchParams?: { error?: string; next?: string };
}) {
  const hasError = searchParams?.error === "invalid";
  const next = searchParams?.next || "/";

  return (
    <main className="flex min-h-screen w-full items-center px-4 py-10 md:px-8 xl:px-12">
      <div className="mx-auto w-full max-w-md">
        <section className="w-full rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f3fafb] to-paper p-6 shadow-panel">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-forest">Paper Serenity Stationery Hub</p>
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Customer Access</p>
        <h1 className="mt-2 font-display text-3xl">Sign In</h1>
        <p className="mt-2 text-sm text-graphite">Login to manage your cart, checkout, and orders.</p>

        {hasError ? (
          <p className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
            Invalid credentials. Please try again.
          </p>
        ) : null}

        <form action="/api/auth/login" method="post" className="mt-5 space-y-4">
          <input type="hidden" name="next" value={next} />

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

        <p className="mt-4 text-sm text-graphite">
          Don&apos;t have an account?{" "}
          <Link href={`/register?next=${next}`} className="font-semibold text-ink hover:underline">
            Create one
          </Link>
        </p>
        <p className="mt-2 text-sm text-graphite">Admin users can sign in here with their admin credentials.</p>
        </section>
      </div>
    </main>
  );
}