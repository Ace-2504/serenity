"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";

type AddressItem = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
};

export default function AccountPage() {
  const [items, setItems] = useState<AddressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadAddresses() {
    setLoading(true);
    const response = await fetch("/api/account/addresses", { cache: "no-store" });

    if (!response.ok) {
      setError("Please sign in to manage your saved addresses.");
      setLoading(false);
      return;
    }

    const data = (await response.json()) as { items: AddressItem[] };
    setItems(data.items);
    setError("");
    setLoading(false);
  }

  useEffect(() => {
    void loadAddresses();
  }, []);

  async function handleAddAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const response = await fetch("/api/account/addresses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to save address.");
      setSaving(false);
      return;
    }

    form.reset();
    await loadAddresses();
    setSaving(false);
  }

  async function setDefaultAddress(addressId: string) {
    setSaving(true);
    setError("");

    const response = await fetch(`/api/account/addresses/${addressId}`, {
      method: "PATCH"
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to update default address.");
      setSaving(false);
      return;
    }

    await loadAddresses();
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f4fbfc] to-paper p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Saved Addresses</h2>
        <p className="mt-1 text-sm text-graphite">Choose the address you want to use at checkout, or add a new one.</p>

        {loading ? <p className="mt-4 text-sm text-graphite">Loading saved addresses...</p> : null}

        {error ? (
          <div className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
            {error} <Link href="/login?next=/account" className="font-semibold underline">Sign in</Link>
          </div>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="mt-4 text-sm text-graphite">No saved addresses yet. Add one below before checkout.</p>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <article key={item.id} className="rounded-xl border border-mist bg-paper/90 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{item.label}</p>
                    <p className="mt-2 text-sm text-graphite">{item.line1}</p>
                    {item.line2 ? <p className="text-sm text-graphite">{item.line2}</p> : null}
                    <p className="text-sm text-graphite">{item.city}, {item.state} {item.postalCode}</p>
                    <p className="text-sm text-graphite">{item.country}</p>
                    <p className="mt-1 text-sm text-graphite">Phone: {item.phone}</p>
                  </div>
                  {item.isDefault ? (
                    <span className="rounded-full bg-forest px-3 py-1 text-xs font-semibold text-canvas">Default</span>
                  ) : null}
                </div>

                {!item.isDefault ? (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void setDefaultAddress(item.id)}
                    className="mt-4 rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas disabled:opacity-50"
                  >
                    Set as default
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Add Address</h2>
        <form onSubmit={handleAddAddress} className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Address label</span>
              <input name="label" required defaultValue="Home" className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Phone</span>
              <input name="phone" type="tel" required className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Address line 1</span>
            <input name="line1" required className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Address line 2</span>
            <input name="line2" className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">City</span>
              <input name="city" required className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">State</span>
              <input name="state" required className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Postal code</span>
              <input name="postalCode" required className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Country</span>
              <input name="country" required defaultValue="India" className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink" />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-graphite">
            <input type="checkbox" name="isDefault" value="true" />
            Make this my default address
          </label>

          <button type="submit" disabled={saving} className="rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-50">
            {saving ? "Saving..." : "Save address"}
          </button>
        </form>
      </section>
    </div>
  );
}