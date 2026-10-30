"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

export function CommitButton({ importId, label = "Import into my books" }: { importId: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function commit() {
    setBusy(true);
    setMessage("Queued — this runs in the background, you can leave this page.");
    const error = await postAndWait(`/api/bi/imports/${importId}/commit`, undefined, setMessage);
    setBusy(false);
    setMessage(error ? `${error} Nothing was saved.` : null);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={commit}
        disabled={busy}
        className="rounded-full border border-forest bg-forest px-5 py-2 text-sm font-semibold text-canvas hover:bg-ink disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Importing…" : label}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-graphite">
        {message}
      </p>
    </div>
  );
}
