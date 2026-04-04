"use client";

import { FormEvent, useState } from "react";

export default function AccountPasswordPage() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function handlePasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const response = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to update password.");
      setSaving(false);
      return;
    }

    form.reset();
    setSuccess("Password updated successfully.");
    setSaving(false);
  }

  return (
    <section className="rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f4fbfc] to-paper p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Reset Password</h2>
      <p className="mt-1 text-sm text-graphite">Use your current password to set a new one for your customer account.</p>

      {error ? (
        <p className="mt-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-4 rounded-lg border border-forest bg-[#ecf8f0] px-3 py-2 text-sm text-forest">
          {success}
        </p>
      ) : null}

      <form onSubmit={handlePasswordReset} className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Current password</span>
          <input
            type="password"
            name="currentPassword"
            required
            className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">New password</span>
          <input
            type="password"
            name="newPassword"
            minLength={8}
            required
            className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium">Confirm new password</span>
          <input
            type="password"
            name="confirmPassword"
            minLength={8}
            required
            className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-50"
        >
          {saving ? "Updating..." : "Update password"}
        </button>
      </form>
    </section>
  );
}
