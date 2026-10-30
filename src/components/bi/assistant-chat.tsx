"use client";

import { useState } from "react";

type ToolRow = Record<string, string | number | null>;
type Answer = {
  answer: string;
  mode: "llm" | "template" | "unsupported";
  note?: string;
  guard: { ok: boolean; checked: number; unmatched: string[] } | null;
  tools: { name: string; args: unknown; result?: { title: string; summary: string; facts: Record<string, unknown>; rows?: ToolRow[] }; error?: string }[];
};

const BADGES: Record<Answer["mode"], { label: string; style: string }> = {
  llm: { label: "Checked: every number is from your reports", style: "border-forest text-forest" },
  template: { label: "Answered from the report itself", style: "border-mist text-graphite" },
  unsupported: { label: "Not one of the approved reports", style: "border-terracotta text-terracotta" }
};

export function AssistantChat({ suggestions }: { suggestions: string[] }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: Answer | null; error?: string }[]>([]);

  async function submit(q: string) {
    if (q.trim().length < 3) return;
    setBusy(true);
    setQuestion("");
    const response = await fetch("/api/bi/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
    const body = await response.json().catch(() => ({}));
    setHistory((h) => [{ q, a: response.ok ? (body as Answer) : null, error: response.ok ? undefined : (body.message ?? "Something went wrong") }, ...h]);
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="question" className="sr-only">
          Your question
        </label>
        <input
          id="question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder="Ask about profit, stock, customers, cash or channels"
          className="min-w-0 flex-1 rounded-full border border-mist bg-canvas px-4 py-2 text-sm"
        />
        <button type="submit" disabled={busy} className="rounded-full border border-ink bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60">
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => void submit(s)} className="rounded-full border border-mist px-3 py-1 text-xs hover:border-ink disabled:opacity-60">
            {s}
          </button>
        ))}
      </div>
      <ul className="space-y-4" aria-live="polite">
        {history.map((h, i) => (
          <li key={i} className="rounded-xl2 border border-mist bg-canvas p-4">
            <p className="text-sm font-semibold">{h.q}</p>
            {h.error ? (
              <p className="mt-2 text-sm text-terracotta">{h.error}</p>
            ) : (
              h.a && (
                <>
                  <p className="mt-2 whitespace-pre-line text-sm">{h.a.answer}</p>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full border px-2 py-0.5 ${BADGES[h.a.mode].style}`}>{BADGES[h.a.mode].label}</span>
                    {h.a.note && <span className="text-graphite">{h.a.note}</span>}
                  </p>
                  {h.a.tools.filter((t) => t.result).length > 0 && (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-graphite">Reports used</summary>
                      {h.a.tools
                        .filter((t) => t.result)
                        .map((t, j) => (
                          <div key={j} className="mt-2 overflow-x-auto">
                            <p className="font-semibold">{t.result!.title}</p>
                            {t.result!.rows && t.result!.rows.length > 0 && (
                              <table className="mt-1 w-full min-w-[420px] text-left">
                                <thead>
                                  <tr>
                                    {Object.keys(t.result!.rows[0]).map((k) => (
                                      <th key={k} className="pr-3 font-semibold text-graphite">
                                        {k.replace(/_/g, " ")}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {t.result!.rows.map((r, k) => (
                                    <tr key={k} className="border-t border-mist-light">
                                      {Object.values(r).map((v, m) => (
                                        <td key={m} className="pr-3 tabular-nums">
                                          {v === null ? "—" : String(v)}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        ))}
                    </details>
                  )}
                </>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
