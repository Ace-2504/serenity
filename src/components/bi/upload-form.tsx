"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UploadForm() {
  const router = useRouter();
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [channel, setChannel] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!files || files.length === 0) {
      setMessage("Choose the files first.");
      return;
    }
    setBusy(true);
    setMessage("Checking every row…");
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    if (channel) form.append("channel", channel);
    const response = await fetch("/api/bi/imports", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setMessage(body.message ?? "Upload failed.");
      return;
    }
    if (body.status === "duplicate") {
      setMessage("These exact files are already the latest import — nothing to do.");
    }
    router.push(`/bi/imports/${body.batchId}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="files" className="block text-sm font-semibold">
        Your files
      </label>
      <input
        id="files"
        name="files"
        type="file"
        multiple
        accept=".csv,text/csv,.xml,text/xml,application/xml,.txt,.tsv,.xlsx"
        onChange={(event) => setFiles(event.target.files)}
        className="block w-full rounded-xl2 border border-mist bg-canvas p-3 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-4 file:py-2 file:text-canvas"
      />
      <ul className="list-disc space-y-1 pl-5 text-xs text-graphite">
        <li>Import template: select all CSV files at once (items, parties, vouchers and control totals are required).</li>
        <li>TallyPrime: export the masters and the Day Book as XML (Data Interchange) and upload both.</li>
        <li>Marketplaces: an Amazon settlement report (V2 flat file) or a Meesho payments export.</li>
        <li>Quick commerce: purchase order and GRN files, plus a sku_map.csv if the platform&apos;s SKUs differ from your item codes.</li>
      </ul>
      <label className="block text-xs text-graphite">
        Platform, for purchase order files (detected from the file name if left blank)
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="mt-1 block rounded-full border border-mist bg-canvas px-3 py-1.5 text-sm text-ink">
          <option value="">Detect</option>
          <option value="blinkit">Blinkit</option>
          <option value="zepto">Zepto</option>
          <option value="instamart">Swiggy Instamart</option>
        </select>
      </label>
      <p className="text-xs text-graphite">Nothing is saved until you review and confirm.</p>
      <button
        type="submit"
        disabled={busy}
        className="rounded-full border border-ink bg-ink px-5 py-2 text-sm font-semibold text-canvas hover:bg-forest disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Validating…" : "Upload and check"}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-graphite">
        {message}
      </p>
    </form>
  );
}
