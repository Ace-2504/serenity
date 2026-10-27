"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

export function Onboarding({ canCreate, stacked = false }: { canCreate: boolean; stacked?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function call(key: string, url: string, body: unknown, pending: string) {
    setBusy(key);
    setMessage(pending);
    const error = await postAndWait(url, body, setMessage);
    setBusy(null);
    setMessage(error);
    router.refresh();
  }

  if (!canCreate) {
    return <p className="text-sm text-graphite">You are not a member of any business yet. Ask the business owner to add you.</p>;
  }

  return (
    <div className={`grid grid-cols-1 gap-4 ${stacked ? "" : "md:grid-cols-2"}`}>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Explore with demo data</h2>
        <p className="mt-2 text-sm text-graphite">
          A fictional stationery distributor with sales through schools, retailers, its shop, its website, Amazon, Meesho, Blinkit, Zepto and Instamart. Clearly labelled as
          demo and kept separate from real data.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call("quick", "/api/bi/demo", { size: "quick" }, "Generating six months of demo data…")}
            className="rounded-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
          >
            {busy === "quick" ? "Loading…" : "Quick demo (6 months)"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => call("full", "/api/bi/demo", { size: "full" }, "Generating two years of demo data — about two minutes, it runs in the background…")}
            className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-60"
          >
            {busy === "full" ? "Loading…" : "Full demo (2 years)"}
          </button>
        </div>
      </section>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Set up your business</h2>
        <p className="mt-2 text-sm text-graphite">Create your business, then upload exports from your accounting software using the template.</p>
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void call("create", "/api/bi/businesses", { name }, "Creating your business…");
          }}
        >
          <label htmlFor="business-name" className="sr-only">
            Business name
          </label>
          <input
            id="business-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Business name"
            required
            minLength={2}
            className="min-w-0 flex-1 rounded-full border border-mist bg-canvas px-4 py-2 text-sm"
          />
          <button type="submit" disabled={busy !== null} className="rounded-full border border-forest px-4 py-2 text-sm font-semibold text-forest hover:bg-forest hover:text-canvas disabled:opacity-60">
            {busy === "create" ? "Creating…" : "Create"}
          </button>
        </form>
      </section>
      <p role="status" aria-live="polite" className={`text-sm text-graphite ${stacked ? "" : "md:col-span-2"}`}>
        {message}
      </p>
    </div>
  );
}
