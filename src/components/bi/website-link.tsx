"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

type State =
  | { kind: "linked"; lastSync: string | null; latestImport: { id: string; status: string } | null }
  | { kind: "elsewhere" }
  | { kind: "unlinked"; canLink: boolean };

/** Links the shop's website to this business, and shows how its books are kept in step. */
export function WebsiteLink({ state }: { state: State }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (url: string, pending: string) => {
    setBusy(true);
    setMessage(pending);
    const error = await postAndWait(url, {}, setMessage);
    setBusy(false);
    setMessage(error ?? "Done.");
    router.refresh();
  };

  if (state.kind === "elsewhere") return <p className="text-sm text-graphite">The website is linked to another of your businesses.</p>;
  if (state.kind === "unlinked") {
    return (
      <div className="space-y-3">
        <p className="text-sm text-graphite">
          Make the shop&apos;s orders, returns, payments, customers, products, stock and purchase bills this business&apos;s books for the website channel. They are
          copied after every order and every stock or purchase change, checked like any import, and saved when they have no errors.
        </p>
        <p className="rounded-lg border border-mustard bg-mustard/20 px-3 py-2 text-xs">
          If you also enter website orders in Tally or BUSY, they would be counted twice: link the website only if it is where these sales are recorded.
        </p>
        {state.canLink ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run("/api/bi/sources/website", "Linking and reading the website…")}
            className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
          >
            Link this website to this business
          </button>
        ) : (
          <p className="text-sm text-graphite">Only the business owner can link the website.</p>
        )}
        {message && <p className="text-sm text-graphite">{message}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-graphite">
        Linked. Orders, customers, stock and purchase bills are copied into the books after every change.
        {state.lastSync ? ` Last saved ${state.lastSync}.` : " Not saved yet."}
        {state.latestImport && (
          <>
            {" "}
            <Link href={`/admin/erp/imports/${state.latestImport.id}` as Route} className="underline">
              Latest sync ({state.latestImport.status})
            </Link>
          </>
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => run("/api/bi/sources/website/sync", "Reading the website…")}
        className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-60"
      >
        Sync now
      </button>
      {message && <p className="text-sm text-graphite">{message}</p>}
    </div>
  );
}
