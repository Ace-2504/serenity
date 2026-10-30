"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

const input = "mt-1 w-full rounded-xl2 border border-mist bg-canvas px-3 py-2 text-sm";
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Reads Amazon.in payouts for a period through the Selling Partner API. */
export function AmazonSync({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(daysAgo(0));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!configured) {
    return (
      <p className="text-sm text-graphite">
        Not connected. The server needs your Selling Partner app&apos;s credentials in its environment (AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_SP_REFRESH_TOKEN); see the
        operations guide. Until then, upload the settlement report from Seller Central above.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-graphite">Reads closed payouts and their fees from Amazon, checks each against its deposit, and waits for your review like an uploaded report.</p>
      <p className="rounded-lg border border-mustard bg-mustard/20 px-3 py-2 text-xs">Not yet tested against a real seller account: compare the first payouts with Seller Central.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-graphite">
          From
          <input type="date" className={input} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-graphite">
          To
          <input type="date" className={input} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        disabled={busy}
        className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          const error = await postAndWait("/api/bi/sources/amazon/sync", { from, to }, setMessage);
          setBusy(false);
          setMessage(error ?? "Done. Open the newest import to review the payouts.");
          router.refresh();
        }}
      >
        {busy ? "Working…" : "Read payouts from Amazon"}
      </button>
      {message && (
        <p role="status" aria-live="polite" className="text-sm text-graphite">
          {message}
        </p>
      )}
    </div>
  );
}
