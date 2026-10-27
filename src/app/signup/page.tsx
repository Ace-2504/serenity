import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listDomainPacks } from "@/domain/packs";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create your account · Serenity BI" };

const ERRORS: Record<string, string> = {
  missing_fields: "Fill in your name, email and password.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Use a password of at least 10 characters.",
  business_name: "Enter your business's name (2 to 120 characters).",
  email_taken: "An account with that email already exists. Sign in instead.",
  rate_limited: "Too many sign-ups from this address. Try again in an hour.",
  closed: "New accounts are not open on this server. Ask its owner to add you.",
};

const input =
  "w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink";

export default function SignupPage({
  searchParams,
}: {
  searchParams?: { error?: string; demo?: string };
}) {
  if (getServerSession()) redirect("/bi");
  const demo = searchParams?.demo === "1";
  const closed = process.env.SIGNUPS_OPEN === "0";
  if (closed && searchParams?.error !== "closed")
    redirect("/signup?error=closed");
  const error = searchParams?.error
    ? (ERRORS[searchParams.error] ?? "Something went wrong. Try again.")
    : null;
  const trades = listDomainPacks().filter((p) => p.status === "active");

  return (
    <main className="flex min-h-[80vh] w-full items-center px-4 py-10 md:px-8">
      <section className="mx-auto w-full max-w-md rounded-2xl border border-mist bg-canvas p-6 shadow-panel">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-forest">
          Serenity BI
        </p>
        <h1 className="mt-2 font-display text-3xl">Create your account</h1>
        <p className="mt-2 text-sm text-graphite">
          {demo
            ? "Then open a demo business and look around. You can add your own business later."
            : "Your business starts empty; the next page shows how to bring in your books."}
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta"
          >
            {error}
          </p>
        )}

        {!closed && (
          <form
            action="/api/auth/signup"
            method="post"
            className="mt-5 space-y-4"
          >
            {demo && <input type="hidden" name="demo" value="1" />}
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Your name</span>
              <input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                className={input}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Email</span>
              <input
                type="email"
                name="email"
                required
                autoComplete="email"
                className={input}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Password</span>
              <input
                type="password"
                name="password"
                required
                minLength={10}
                autoComplete="new-password"
                aria-describedby="password-hint"
                className={input}
              />
              <span
                id="password-hint"
                className="mt-1 block text-xs text-graphite"
              >
                At least 10 characters.
              </span>
            </label>
            <fieldset className="space-y-4 rounded-xl border border-mist p-3">
              <legend className="px-1 text-sm font-medium">
                Your business{demo ? " (optional)" : ""}
              </legend>
              <label className="block">
                <span className="mb-1 block text-sm">Business name</span>
                <input
                  name="businessName"
                  required={!demo}
                  minLength={2}
                  maxLength={120}
                  autoComplete="organization"
                  className={input}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm">Trade</span>
                <select
                  name="trade"
                  defaultValue="stationery"
                  className={input}
                >
                  {trades.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            <button className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest">
              Create account
            </button>
          </form>
        )}

        <p className="mt-4 text-xs text-graphite">
          You own your business&apos;s data and can delete it at any time.{" "}
          <Link href={"/privacy" as Route} className="underline">
            How your data is handled
          </Link>
          .
        </p>
        <p className="mt-3 text-sm text-graphite">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-ink hover:underline"
          >
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
