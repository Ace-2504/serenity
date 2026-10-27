"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

export function RefreshFindingsButton({ label = "Check for problems now" }: { label?: string }) {
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
          const error = await postAndWait("/api/bi/findings/refresh", undefined, setMessage);
          setBusy(false);
          setMessage(error);
          router.refresh();
        }}
        className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper disabled:opacity-60"
      >
        {busy ? "Checking…" : label}
      </button>
      {message && (
        <span role="status" className="text-xs text-graphite">
          {message}
        </span>
      )}
    </span>
  );
}
