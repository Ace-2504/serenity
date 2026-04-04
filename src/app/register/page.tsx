"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields:   "Please fill in all required fields.",
  invalid_email:    "Please enter a valid email address.",
  weak_password:    "Password must be at least 8 characters.",
  password_mismatch:"Passwords do not match — please try again.",
  email_taken:      "An account with that email already exists. Try signing in instead.",
};

function RegisterForm() {
  const params = useSearchParams();
  const errorCode = params.get("error");
  const next = params.get("next") || "/";
  const confirmRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const pw = passwordRef.current?.value ?? "";
    const cpw = confirmRef.current?.value ?? "";
    if (pw !== cpw) {
      e.preventDefault();
      confirmRef.current?.setCustomValidity("Passwords do not match.");
      confirmRef.current?.reportValidity();
      return;
    }
    confirmRef.current?.setCustomValidity("");
  }

  const errorMsg = errorCode ? ERROR_MESSAGES[errorCode] ?? "Something went wrong. Please try again." : null;

  return (
    <main className="flex min-h-screen w-full items-center px-4 py-10 md:px-8 xl:px-12">
      <div className="mx-auto w-full max-w-md">
        <section className="w-full rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f3fafb] to-paper p-6 shadow-panel">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-forest">Paper Serenity Stationery Hub</p>
        <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Customer Access</p>
        <h1 className="mt-2 font-display text-3xl">Create Account</h1>
        <p className="mt-2 text-sm text-graphite">Join to save your cart, place orders, and track shipments.</p>

        {errorMsg && (
          <p className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
            {errorMsg}
          </p>
        )}

        <form
          action="/api/auth/register"
          method="post"
          onSubmit={handleSubmit}
          className="mt-5 space-y-4"
        >
          <input type="hidden" name="next" value={next} />

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="mb-1 block text-sm font-medium">First name <span className="text-terracotta">*</span></span>
              <input
                type="text"
                name="firstName"
                required
                autoComplete="given-name"
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block flex-1">
              <span className="mb-1 block text-sm font-medium">Last name</span>
              <input
                type="text"
                name="lastName"
                autoComplete="family-name"
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Email <span className="text-terracotta">*</span></span>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Password <span className="text-terracotta">*</span></span>
            <input
              ref={passwordRef}
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
            <span className="mt-1 block text-xs text-graphite">Minimum 8 characters</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Confirm password <span className="text-terracotta">*</span></span>
            <input
              ref={confirmRef}
              type="password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <div className="rounded-xl border border-mist bg-paper p-4">
            <p className="text-sm font-semibold text-ink">Default Address</p>
            <p className="mt-1 text-xs text-graphite">This address will be saved to your account and used at checkout.</p>

            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">Address label <span className="text-terracotta">*</span></span>
                <input
                  type="text"
                  name="label"
                  required
                  defaultValue="Home"
                  className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Address line 1 <span className="text-terracotta">*</span></span>
                <input
                  type="text"
                  name="line1"
                  required
                  autoComplete="address-line1"
                  className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Address line 2</span>
                <input
                  type="text"
                  name="line2"
                  autoComplete="address-line2"
                  className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">City <span className="text-terracotta">*</span></span>
                  <input
                    type="text"
                    name="city"
                    required
                    autoComplete="address-level2"
                    className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">State <span className="text-terracotta">*</span></span>
                  <input
                    type="text"
                    name="state"
                    required
                    autoComplete="address-level1"
                    className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Postal code <span className="text-terracotta">*</span></span>
                  <input
                    type="text"
                    name="postalCode"
                    required
                    autoComplete="postal-code"
                    className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium">Phone <span className="text-terracotta">*</span></span>
                  <input
                    type="tel"
                    name="phone"
                    required
                    autoComplete="tel"
                    className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium">Country <span className="text-terracotta">*</span></span>
                <input
                  type="text"
                  name="country"
                  required
                  defaultValue="India"
                  autoComplete="country-name"
                  className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas"
          >
            Create account
          </button>
        </form>

        <p className="mt-4 text-sm text-graphite">
          Already have an account?{" "}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-ink hover:underline">
            Sign in
          </Link>
        </p>
        </section>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
