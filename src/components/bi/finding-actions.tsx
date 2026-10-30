"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "accept" | "dismiss" | "snooze" | "reopen";
const BUTTONS: Record<string, { action: Action; label: string; primary?: boolean }[]> = {
  open: [
    { action: "accept", label: "I'll act on this", primary: true },
    { action: "snooze", label: "Remind me in 30 days" },
    { action: "dismiss", label: "Not relevant" }
  ],
  snoozed: [
    { action: "accept", label: "I'll act on this", primary: true },
    { action: "reopen", label: "Reopen now" },
    { action: "dismiss", label: "Not relevant" }
  ],
  dismissed: [{ action: "reopen", label: "Reopen" }]
};

/** Owner decision buttons. Nothing is executed automatically: accepting only starts measurement. */
export function FindingActions({ findingId, status, canDecide, withNote = false }: { findingId: string; status: string; canDecide: boolean; withNote?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const buttons = BUTTONS[status] ?? [];
  if (buttons.length === 0) return null;
  if (!canDecide) return <p className="text-xs text-graphite">Only the business owner can accept or dismiss recommendations.</p>;

  async function act(action: Action) {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/bi/findings/${findingId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note: note.trim() || undefined })
    });
    setBusy(false);
    if (!response.ok) {
      setError((await response.json().catch(() => ({}))).message ?? "Could not save your decision.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {withNote && (
        <label className="block text-xs text-graphite">
          Note (optional): what you will do, or why it does not apply
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-xl2 border border-mist bg-canvas px-3 py-2 text-sm text-ink" />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.action}
            type="button"
            disabled={busy}
            onClick={() => act(b.action)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold disabled:opacity-60 ${b.primary ? "border-forest bg-forest text-canvas hover:bg-ink" : "border-mist hover:border-ink hover:bg-paper"}`}
          >
            {b.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-xs text-terracotta">
          {error}
        </p>
      )}
    </div>
  );
}
