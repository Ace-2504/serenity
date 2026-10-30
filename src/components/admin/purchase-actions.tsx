"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Mark a bill paid today, or remove one entered by mistake (two clicks: no undo). */
export function PurchaseActions({ billId, paid }: { billId: string; paid: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = async (method: "PATCH" | "DELETE", body?: unknown) => {
    setError(null);
    const r = await fetch(`/api/admin/purchases/${billId}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.message ?? "Failed");
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!paid && (
        <button type="button" className="rounded-full border border-mist px-2 py-0.5 text-xs hover:border-ink" onClick={() => call("PATCH", { paidOn: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) })}>
          Mark paid today
        </button>
      )}
      {confirming ? (
        <button type="button" className="rounded-full border border-terracotta px-2 py-0.5 text-xs text-terracotta" onClick={() => call("DELETE")}>
          Remove bill and its stock
        </button>
      ) : (
        <button type="button" className="rounded-full border border-mist px-2 py-0.5 text-xs text-graphite hover:border-terracotta" onClick={() => setConfirming(true)}>
          Remove…
        </button>
      )}
      {error && <span className="text-xs text-terracotta">{error}</span>}
    </div>
  );
}
