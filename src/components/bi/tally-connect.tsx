"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

type Settings = { url: string; company: string; from?: string; autoCommit: boolean; dailySync: boolean };

const input = "mt-1 w-full rounded-xl2 border border-mist bg-canvas px-3 py-2 text-sm";

/** Connects a live TallyPrime: address, company, options; test, save and sync. */
export function TallyConnect({ initial, connected }: { initial: Settings | null; connected: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<Settings>(initial ?? { url: "http://localhost:9000", company: "", autoCommit: false, dailySync: false });
  const [companies, setCompanies] = useState<{ name: string; booksFrom: string | null }[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Settings>) => setS((prev) => ({ ...prev, ...patch }));

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-graphite">
        Reads masters and the Day Book straight from TallyPrime on your network, then checks them like an upload. Switch on TallyPrime&apos;s server (connectivity, usually
        port 9000) and keep the company open.
      </p>
      <p className="rounded-lg border border-mustard bg-mustard/20 px-3 py-2 text-xs">Not yet tested against a real TallyPrime: check the first sync&apos;s totals against Tally&apos;s registers.</p>
      <label className="block text-xs text-graphite">
        Tally address
        <input className={input} value={s.url} onChange={(e) => set({ url: e.target.value })} placeholder="http://192.168.1.20:9000" />
      </label>
      <button
        type="button"
        disabled={busy}
        className="rounded-full border border-mist px-4 py-1.5 text-sm hover:border-ink disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setMessage("Asking Tally which companies are open…");
          const r = await post("/api/bi/sources/tally/test", { url: s.url });
          setBusy(false);
          if (!r.ok) return setMessage(r.data.message ?? "Tally did not answer");
          setCompanies(r.data.companies);
          if (r.data.companies.length === 1) set({ company: r.data.companies[0].name });
          setMessage(r.data.companies.length ? `Tally answered: ${r.data.companies.length} compan${r.data.companies.length === 1 ? "y" : "ies"} open.` : "Tally answered, but no company is open.");
        }}
      >
        Test connection
      </button>
      <label className="block text-xs text-graphite">
        Company (exactly as in Tally)
        {companies.length > 1 ? (
          <select className={input} value={s.company} onChange={(e) => set({ company: e.target.value })}>
            <option value="">Choose…</option>
            {companies.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <input className={input} value={s.company} onChange={(e) => set({ company: e.target.value })} />
        )}
      </label>
      <label className="block text-xs text-graphite">
        Read from (blank: from the date the books begin)
        <input type="date" className={`${input} max-w-[12rem]`} value={s.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.autoCommit || s.dailySync} disabled={s.dailySync} onChange={(e) => set({ autoCommit: e.target.checked })} />
        Save a sync without review when it has no errors
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.dailySync} onChange={(e) => set({ dailySync: e.target.checked })} />
        Sync once a day (needs the background worker)
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !s.company}
          className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-60"
          onClick={async () => {
            setBusy(true);
            const r = await post("/api/bi/sources/tally", s);
            setBusy(false);
            setMessage(r.ok ? "Saved." : (r.data.message ?? "Could not save"));
            router.refresh();
          }}
        >
          Save connection
        </button>
        {connected && (
          <button
            type="button"
            disabled={busy}
            className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
            onClick={async () => {
              setBusy(true);
              const error = await postAndWait("/api/bi/sources/tally/sync", {}, setMessage);
              setBusy(false);
              setMessage(error ?? "Sync finished. Open the newest import to review it, or see it in your reports if it was saved.");
              router.refresh();
            }}
          >
            {busy ? "Working…" : "Sync now"}
          </button>
        )}
      </div>
      {message && (
        <p role="status" aria-live="polite" className="text-sm text-graphite">
          {message}
        </p>
      )}
    </div>
  );
}
