"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = { status: string; label: string; danger?: boolean };

/** The next steps for an order, and recording cash collected on delivery. */
export function OrderActions({ orderId, next, cashDue }: { orderId: string; next: Action[]; cashDue: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const post = async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setConfirm(null);
    if (!r.ok) return setError(d.message ?? "Failed");
    router.refresh();
  };
  if (next.length === 0 && !cashDue) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-mist pt-3">
      <div className="flex flex-wrap gap-2">
        {next.map((a) =>
          a.danger && confirm !== a.status ? (
            <button key={a.status} type="button" disabled={busy} onClick={() => setConfirm(a.status)} className="rounded-full border border-mist px-3 py-1.5 text-sm hover:border-terracotta disabled:opacity-60">
              {a.label}…
            </button>
          ) : (
            <button
              key={a.status}
              type="button"
              disabled={busy}
              onClick={() => post(`/api/admin/orders/${orderId}/status`, { status: a.status })}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${a.danger ? "border-terracotta text-terracotta" : "border-ink hover:bg-paper"}`}
            >
              {a.danger ? `Confirm: ${a.label.toLowerCase()} and restock` : a.label}
            </button>
          )
        )}
        {cashDue && (
          <button type="button" disabled={busy} onClick={() => post(`/api/admin/orders/${orderId}/cash-collected`)} className="rounded-full border border-forest px-3 py-1.5 text-sm font-semibold text-forest hover:bg-forest hover:text-canvas disabled:opacity-60">
            Mark cash collected
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-terracotta">
          {error}
        </p>
      )}
    </div>
  );
}
