"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Variant = { id: string; label: string; gstPercent: number; costPaise: number | null };
type Supplier = { id: string; name: string };
type Line = { variantId: string; quantity: string; unitCost: string; gstPercent: string };

const input = "w-full rounded-lg border border-mist bg-canvas px-2 py-1.5 text-sm";
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Enter a supplier's bill line by line; the total is shown the way the books will compute it. */
export function PurchaseForm({ suppliers, variants }: { suppliers: Supplier[]; variants: Variant[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "new");
  const [newSupplier, setNewSupplier] = useState({ name: "", gstin: "", creditDays: "0" });
  const [billNumber, setBillNumber] = useState("");
  const [billDate, setBillDate] = useState(today());
  const [paid, setPaid] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ variantId: "", quantity: "1", unitCost: "", gstPercent: "18" }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = useMemo(() => new Map(variants.map((v) => [v.id, v])), [variants]);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((sum, l) => {
    const taxable = (Number(l.quantity) || 0) * toPaise(l.unitCost || "0");
    return sum + taxable + Math.round((taxable * (Number(l.gstPercent) || 0)) / 100);
  }, 0);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        const r = await fetch("/api/admin/purchases", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            supplier: supplierId === "new" ? { name: newSupplier.name, gstin: newSupplier.gstin, creditDays: Number(newSupplier.creditDays) || 0 } : { id: supplierId },
            billNumber,
            billDate,
            paidOn: paid ? billDate : "",
            lines: lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitCostPaise: toPaise(l.unitCost), gstPercent: Number(l.gstPercent) }))
          })
        });
        const d = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setMessage({ ok: false, text: d.message ?? "Could not record the bill" });
        setMessage({ ok: true, text: "Recorded. Stock is updated and the books will follow in a moment." });
        setBillNumber("");
        setLines([{ variantId: "", quantity: "1", unitCost: "", gstPercent: "18" }]);
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-graphite">
          Supplier
          <select aria-label="Supplier" className={input} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="new">+ New supplier</option>
          </select>
        </label>
        <label className="text-xs text-graphite">
          Bill number
          <input className={input} required maxLength={40} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        </label>
        <label className="text-xs text-graphite">
          Bill date
          <input type="date" className={input} required max={today()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </label>
      </div>
      {supplierId === "new" && (
        <div className="grid gap-3 rounded-lg border border-mist p-3 sm:grid-cols-3">
          <label className="text-xs text-graphite">
            Supplier name
            <input className={input} required minLength={2} value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} />
          </label>
          <label className="text-xs text-graphite">
            GSTIN (optional)
            <input className={input} maxLength={15} value={newSupplier.gstin} onChange={(e) => setNewSupplier({ ...newSupplier, gstin: e.target.value })} />
          </label>
          <label className="text-xs text-graphite">
            Days to pay
            <input type="number" min={0} max={365} className={input} value={newSupplier.creditDays} onChange={(e) => setNewSupplier({ ...newSupplier, creditDays: e.target.value })} />
          </label>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs text-graphite">
            <tr>
              <th className="py-1 pr-2 font-medium">Product</th>
              <th className="w-20 py-1 pr-2 font-medium">Qty</th>
              <th className="w-28 py-1 pr-2 font-medium">Rate (₹, before GST)</th>
              <th className="w-20 py-1 pr-2 font-medium">GST %</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2">
                  <select
                    aria-label={`Product ${i + 1}`}
                    className={input}
                    required
                    value={l.variantId}
                    onChange={(e) => {
                      const v = byId.get(e.target.value);
                      setLine(i, { variantId: e.target.value, gstPercent: String(v?.gstPercent ?? 18), unitCost: l.unitCost || (v?.costPaise != null ? (v.costPaise / 100).toFixed(2) : "") });
                    }}
                  >
                    <option value="">Choose…</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Quantity ${i + 1}`} type="number" min={1} required className={input} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`Rate ${i + 1}`} type="number" min={0} step="0.01" required className={input} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                </td>
                <td className="py-1 pr-2">
                  <input aria-label={`GST ${i + 1}`} type="number" min={0} max={50} required className={input} value={l.gstPercent} onChange={(e) => setLine(i, { gstPercent: e.target.value })} />
                </td>
                <td className="py-1">
                  {lines.length > 1 && (
                    <button type="button" aria-label={`Remove line ${i + 1}`} className="text-graphite hover:text-terracotta" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="rounded-full border border-mist px-3 py-1 text-sm hover:border-ink" onClick={() => setLines((ls) => [...ls, { variantId: "", quantity: "1", unitCost: "", gstPercent: "18" }])}>
          + Add product
        </button>
        <p className="text-sm">
          Bill total with GST: <strong>{inr(total)}</strong>
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        Paid on the bill date
      </label>
      <button type="submit" disabled={busy} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60">
        {busy ? "Recording…" : "Record bill and add to stock"}
      </button>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-forest" : "text-terracotta"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
