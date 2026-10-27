"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { postAndWait } from "@/components/bi/jobs";

async function call(url: string, method: string, body?: unknown): Promise<string | null> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.ok) return null;
  return (await r.json().catch(() => ({}))).message ?? "Something went wrong";
}

const input = "w-full rounded-xl2 border border-mist bg-canvas px-3 py-2 text-sm";

export function NewCampaignForm({ audiences, segments }: { audiences: Record<string, string>; segments: Record<string, string> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [source, setSource] = useState(Object.keys(audiences)[0]);
  const [segment, setSegment] = useState(Object.keys(segments)[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await fetch("/api/bi/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, goal, audience: source === "segment" ? { source, segment } : { source } }) });
        const b = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok) return setError(b.message ?? "Could not create the campaign");
        router.push(`/bi/campaigns/${b.id}` as Route);
      }}
    >
      <label className="text-xs text-graphite">
        Name
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} placeholder="Win back schools before the new term" />
      </label>
      <label className="text-xs text-graphite">
        Who
        <select className={input} value={source} onChange={(e) => setSource(e.target.value)}>
          {Object.entries(audiences)
            .filter(([k]) => k !== "past_buyers_of_item")
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      {source === "segment" && (
        <label className="text-xs text-graphite">
          Segment
          <select className={input} value={segment} onChange={(e) => setSegment(e.target.value)}>
            {Object.entries(segments).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-xs text-graphite md:col-span-2">
        Goal
        <input className={input} value={goal} onChange={(e) => setGoal(e.target.value)} required minLength={3} maxLength={500} placeholder="Get an order from each before July" />
      </label>
      <div className="md:col-span-2">
        <button type="submit" disabled={busy} className="rounded-full border border-ink bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60">
          {busy ? "Creating…" : "Create draft"}
        </button>
        <span className="ml-3 text-xs text-graphite">Creating a draft sends nothing.</span>
        {error && <p className="mt-2 text-sm text-terracotta">{error}</p>}
      </div>
    </form>
  );
}

export function CampaignEditor({
  id,
  subject: s0,
  body: b0,
  offer: o0,
  editable
}: {
  id: string;
  subject: string;
  body: string;
  offer: number | null;
  editable: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(s0);
  const [body, setBody] = useState(b0);
  const [offer, setOffer] = useState(o0 === null ? "" : String(o0));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!editable) return null;
  return (
    <div className="space-y-3">
      <label className="block text-xs text-graphite">
        Subject
        <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </label>
      <label className="block text-xs text-graphite">
        Message. Use {"{{name}}"} for the customer&apos;s name and {"{{offer}}"} for the offer; an unsubscribe link is added to every message.
        <textarea className={input} rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} />
      </label>
      <label className="block text-xs text-graphite">
        Offer: % off (leave blank for no offer; you approve it separately, nothing is discounted automatically)
        <input className={`${input} max-w-[10rem]`} inputMode="decimal" value={offer} onChange={(e) => setOffer(e.target.value)} />
      </label>
      <button
        type="button"
        className="mr-2 rounded-full border border-mist px-4 py-1.5 text-sm hover:border-ink"
        onClick={async () => {
          const offerPct = offer.trim() === "" ? null : Number(offer);
          const r = await fetch(`/api/bi/campaigns/${id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offerPct }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return setError(d.message ?? "No suggestion");
          setSubject(d.subject);
          setBody(d.body);
          setSaved(`Suggested wording (${d.source === "model" ? "local model" : "template"}) — review and edit, then save.${d.note ? ` ${d.note}` : ""}`);
        }}
      >
        Suggest wording
      </button>
      <button
        type="button"
        className="rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper"
        onClick={async () => {
          setError(null);
          const err =
            (await call(`/api/bi/campaigns/${id}`, "PATCH", { subject, body })) ??
            (await call(`/api/bi/campaigns/${id}`, "PATCH", { offer: offer.trim() === "" ? null : { kind: "percent_off", value: Number(offer) } }));
          if (err) setError(err);
          else setSaved("Saved. Changed parts need approving again.");
          router.refresh();
        }}
      >
        Save draft
      </button>
      {saved && !error && <p className="text-xs text-graphite">{saved}</p>}
      {error && <p className="text-sm text-terracotta">{error}</p>}
    </div>
  );
}

export function CampaignActions({ id, next, canDecide, cancellable }: { id: string; next: string | null; canDecide: boolean; cancellable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!canDecide) return <p className="text-xs text-graphite">Only the business owner can approve and send campaigns.</p>;
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(await fn());
    setBusy(false);
    router.refresh();
  };
  const LABELS: Record<string, string> = { audience: "Approve the audience", content: "Approve the message", offer: "Approve the offer", send: "Approve sending" };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {next && next !== "ready" && (
        <button type="button" disabled={busy} onClick={() => run(() => call(`/api/bi/campaigns/${id}/approve`, "POST", { step: next }))} className="rounded-full border border-forest bg-forest px-4 py-1.5 text-sm font-semibold text-canvas hover:bg-ink disabled:opacity-60">
          {LABELS[next]}
        </button>
      )}
      {next === "ready" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => postAndWait(`/api/bi/campaigns/${id}/send`, undefined, () => undefined))}
          className="rounded-full border border-terracotta bg-terracotta px-4 py-1.5 text-sm font-semibold text-canvas disabled:opacity-60"
        >
          Send now
        </button>
      )}
      {cancellable && (
        <button type="button" disabled={busy} onClick={() => run(() => call(`/api/bi/campaigns/${id}/cancel`, "POST"))} className="rounded-full border border-mist px-4 py-1.5 text-sm hover:border-ink disabled:opacity-60">
          Cancel campaign
        </button>
      )}
      {error && <p className="w-full text-sm text-terracotta">{error}</p>}
    </div>
  );
}

export function ConsentForm({ partyId }: { partyId: string }) {
  const router = useRouter();
  const [source, setSource] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const record = async (status: "granted" | "revoked") => {
    const err = await call("/api/bi/consents", "POST", { partyId, channel: "email", status, source: source || (status === "revoked" ? "Asked not to be contacted" : "") });
    setMessage(err ?? (status === "granted" ? "Recorded: may receive email." : "Recorded: will not be emailed."));
    router.refresh();
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs text-graphite">
        How was permission given? (e.g. &quot;signed form at counter, 12 Mar&quot;)
        <input className={input} value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={source.trim().length < 3} onClick={() => record("granted")} className="rounded-full border border-forest px-3 py-1 text-xs font-semibold text-forest disabled:opacity-50">
          Record email consent
        </button>
        <button type="button" onClick={() => record("revoked")} className="rounded-full border border-mist px-3 py-1 text-xs">
          Record opt-out
        </button>
      </div>
      {message && <p className="text-xs text-graphite">{message}</p>}
    </div>
  );
}
