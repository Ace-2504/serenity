"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

/** Starts a background job and refreshes the page when it finishes. */
export function JobButton({ url, label, busyLabel }: { url: string; label: string; busyLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const error = await postAndWait(url, undefined, setMessage);
          setBusy(false);
          setMessage(error);
          router.refresh();
        }}
        className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-60"
      >
        {busy ? busyLabel : label}
      </button>
      {message && (
        <span role="status" className="text-xs text-graphite">
          {message}
        </span>
      )}
    </span>
  );
}
