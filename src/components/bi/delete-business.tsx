"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Deleting a business needs its name typed out: there is no undo. */
export function DeleteBusiness({ tenantId, name }: { tenantId: string; name: string }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const r = await fetch(`/api/bi/businesses/${tenantId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmName: typed }) });
        const d = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setError(d.message ?? "Could not delete the business");
        router.push("/admin/erp");
        router.refresh();
      }}
    >
      <label htmlFor="confirm-business-name" className="block text-sm">
        Type <strong>{name}</strong> to confirm
      </label>
      <input
        id="confirm-business-name"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        className="w-full max-w-sm rounded-xl border border-mist bg-canvas px-3 py-2 text-sm outline-none focus:border-ink"
      />
      <div>
        <button
          type="submit"
          disabled={busy || typed.trim() !== name}
          className="rounded-full border border-terracotta px-5 py-2 text-sm font-semibold text-terracotta hover:bg-terracotta hover:text-canvas disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete this business and its data"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-terracotta">
          {error}
        </p>
      )}
    </form>
  );
}
