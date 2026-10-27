"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

export function Onboarding({
  stacked = false,
  fullDemo = true,
}: {
  stacked?: boolean;
  fullDemo?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("stationery");

  async function call(
    key: string,
    url: string,
    body: unknown,
    pending: string,
  ) {
    setBusy(key);
    setMessage(pending);
    const error = await postAndWait(url, body, setMessage);
    setBusy(null);
    setMessage(error);
    router.refresh();
  }

  return (
    <div
      className={`grid grid-cols-1 gap-4 ${stacked ? "" : "md:grid-cols-2"}`}
    >
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Explore with demo data</h2>
        <p className="mt-2 text-sm text-graphite">
          A fictional stationery distributor with sales through schools,
          retailers, its shop, its website, Amazon, Meesho, Blinkit, Zepto and
          Instamart. Clearly labelled as demo and kept separate from real data.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call(
                "quick",
                "/api/bi/demo",
                { size: "quick" },
                "Generating six months of demo data…",
              )
            }
            className="rounded-full border border-ink bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
          >
            {busy === "quick" ? "Loading…" : "Quick demo (6 months)"}
          </button>
          {fullDemo && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call(
                  "full",
                  "/api/bi/demo",
                  { size: "full" },
                  "Generating two years of demo data — about two minutes, it runs in the background…",
                )
              }
              className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-60"
            >
              {busy === "full" ? "Loading…" : "Full demo (2 years)"}
            </button>
          )}
        </div>
        <p className="mt-4 text-sm text-graphite">
          Or a fictional chemist: counter sales billed at MRP, regular patients,
          clinics on credit, and stock tracked by batch and expiry.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              call(
                "pharmacy-quick",
                "/api/bi/demo",
                { size: "quick", pack: "pharmacy" },
                "Generating six months of pharmacy demo data…",
              )
            }
            className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-60"
          >
            {busy === "pharmacy-quick"
              ? "Loading…"
              : "Pharmacy demo (6 months)"}
          </button>
          {fullDemo && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call(
                  "pharmacy-full",
                  "/api/bi/demo",
                  { size: "full", pack: "pharmacy" },
                  "Generating two years of pharmacy demo data — it runs in the background…",
                )
              }
              className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-60"
            >
              {busy === "pharmacy-full"
                ? "Loading…"
                : "Pharmacy demo (2 years)"}
            </button>
          )}
        </div>
      </section>
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Set up your business</h2>
        <p className="mt-2 text-sm text-graphite">
          Create your business, then upload exports from your accounting
          software using the template.
        </p>
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void call(
              "create",
              "/api/bi/businesses",
              { name, domainPack: trade },
              "Creating your business…",
            );
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
          <label htmlFor="business-trade" className="sr-only">
            Trade
          </label>
          <select
            id="business-trade"
            value={trade}
            onChange={(event) => setTrade(event.target.value)}
            className="rounded-full border border-mist bg-canvas px-4 py-2 text-sm"
          >
            <option value="stationery">Stationery distribution</option>
            <option value="pharmacy">Retail pharmacy / chemist</option>
          </select>
          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-full border border-forest px-4 py-2 text-sm font-semibold text-forest hover:bg-forest hover:text-canvas disabled:opacity-60"
          >
            {busy === "create" ? "Creating…" : "Create"}
          </button>
        </form>
      </section>
      <p
        role="status"
        aria-live="polite"
        className={`text-sm text-graphite ${stacked ? "" : "md:col-span-2"}`}
      >
        {message}
      </p>
    </div>
  );
}
