"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Mapping = { file: string; voucherType: string; columns: Record<string, string> };
type Preview = { file: string; header: string[]; sample: string[][]; rows: number; mapping: Mapping; remembered: boolean };
type Field = { key: string; label: string; required: boolean };

const select = "w-full rounded-lg border border-mist bg-canvas px-2 py-1 text-xs";

/** Upload register spreadsheets, confirm which column is which, then stage them for review. */
export function RegisterUpload({ fields, voucherTypes }: { fields: Field[]; voucherTypes: Record<string, string> }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const form = () => {
    const f = new FormData();
    for (const file of files) f.append("files", file);
    return f;
  };
  const setMapping = (i: number, patch: Partial<Mapping>) => setPreviews((ps) => ps.map((p, n) => (n === i ? { ...p, mapping: { ...p.mapping, ...patch } } : p)));

  return (
    <div className="space-y-3">
      <p className="text-sm text-graphite">
        For BUSY or any package without a template export: export the sales, purchase and return registers <strong>with item details</strong> for the same period and upload them
        together. You confirm which column is which; the choice is remembered for next time.
      </p>
      <p className="rounded-lg border border-mustard bg-mustard/20 px-3 py-2 text-xs">BUSY&apos;s exact export layout has not been checked against real files: compare the totals with BUSY&apos;s register totals.</p>
      <input
        type="file"
        multiple
        accept=".xlsx,.csv"
        aria-label="Register files"
        className="block w-full text-sm"
        onChange={async (e) => {
          const chosen = [...(e.target.files ?? [])];
          setFiles(chosen);
          setPreviews([]);
          setError(null);
          if (chosen.length === 0) return;
          setBusy(true);
          const f = new FormData();
          for (const file of chosen) f.append("files", file);
          const r = await fetch("/api/bi/imports/register/preview", { method: "POST", body: f });
          const d = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) return setError(d.message ?? "Could not read the files");
          setPreviews(d.files);
        }}
      />
      {previews.map((p, i) => (
        <section key={p.file} className="space-y-2 rounded-lg border border-mist p-3">
          <h3 className="text-sm font-semibold">
            {p.file} <span className="font-normal text-graphite">· {p.rows} rows{p.remembered ? " · mapping remembered from last time" : ""}</span>
          </h3>
          <label className="block text-xs text-graphite">
            This file is
            <select className={select} value={p.mapping.voucherType} onChange={(e) => setMapping(i, { voucherType: e.target.value })}>
              {Object.entries(voucherTypes).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <label key={f.key} className="block text-xs text-graphite">
                {f.label}
                {f.required ? " *" : ""}
                <select className={select} value={p.mapping.columns[f.key] ?? ""} onChange={(e) => setMapping(i, { columns: { ...p.mapping.columns, [f.key]: e.target.value } })}>
                  <option value="">— not in this file —</option>
                  {p.header.filter(Boolean).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="text-graphite">
                <tr>
                  {p.header.map((h, n) => (
                    <th key={n} className="whitespace-nowrap py-1 pr-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.sample.map((row, r) => (
                  <tr key={r} className="border-t border-mist-light">
                    {row.map((c, n) => (
                      <td key={n} className="whitespace-nowrap py-1 pr-3">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {previews.length > 0 && (
        <button
          type="button"
          disabled={busy}
          className="rounded-full border border-ink bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            setError(null);
            const f = form();
            f.append("mappings", JSON.stringify(previews.map((p) => ({ ...p.mapping, columns: Object.fromEntries(Object.entries(p.mapping.columns).filter(([, v]) => v)) }))));
            const r = await fetch("/api/bi/imports/register", { method: "POST", body: f });
            const d = await r.json().catch(() => ({}));
            setBusy(false);
            if (!r.ok) return setError(d.message ?? "Could not check the registers");
            router.push(`/bi/imports/${d.batchId}` as Route);
          }}
        >
          {busy ? "Checking…" : "Check the registers"}
        </button>
      )}
      {busy && previews.length === 0 && <p className="text-sm text-graphite">Reading the files…</p>}
      {error && <p className="text-sm text-terracotta">{error}</p>}
      <p className="text-xs text-graphite">Nothing is saved until you review and confirm.</p>
    </div>
  );
}
