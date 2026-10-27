import Link from "next/link";
import { notFound } from "next/navigation";
import { CommitButton } from "@/components/bi/commit-button";
import { ENTITY_LABELS, formatCount, formatDate, formatDateTime, formatInr, METRIC_LABELS, plural } from "@/components/bi/format";
import { StatusChip } from "@/components/bi/status-chip";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";
import type { DbReconciliation, ImportSummary } from "@/server/ingest/pipeline";

export default async function ImportPage({ params }: { params: { importId: string } }) {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  const batch = await bi.db.importBatch.findUnique({
    where: { id: params.importId },
    include: { dataSource: { select: { name: true } }, issues: { take: 200, orderBy: [{ severity: "asc" }, { code: "asc" }, { rowRef: "asc" }] } }
  });
  if (!batch) notFound();

  const summary = batch.counts as unknown as ImportSummary;
  const reconciliation = (batch.reconciliation ?? []) as unknown as DbReconciliation;
  const canCommit = CAN_IMPORT.includes(bi.role) && (batch.status === "validated" || batch.status === "failed");
  const issueTotal = summary.issues.errors + summary.issues.warnings;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl2 border border-mist bg-canvas p-5">
        <div>
          <p className="text-sm text-graphite">
            <Link href="/bi/imports" className="underline">
              Imports
            </Link>{" "}
            / {batch.dataSource.name}
          </p>
          <h2 className="mt-1 font-display text-2xl">
            {summary.period ? `${formatDate(summary.period.from)} – ${formatDate(summary.period.to)}` : "Import"}
          </h2>
          <p className="mt-1 text-sm text-graphite">
            Uploaded {formatDateTime(batch.createdAt)}
            {batch.committedAt && ` · imported ${formatDateTime(batch.committedAt)}`}
          </p>
          <div className="mt-3">
            <StatusChip status={batch.status} />
          </div>
          {batch.status === "failed" && batch.error && <p className="mt-2 text-sm text-terracotta">Last attempt failed: {batch.error}</p>}
          {batch.status === "rejected" && <p className="mt-2 text-sm text-terracotta">Fix the errors below in your files and upload them again. Nothing has been saved.</p>}
          {summary.adapter && <AdapterNote adapter={summary.adapter} />}
        </div>
        {canCommit && <CommitButton importId={batch.id} label={batch.status === "failed" ? "Try the import again" : "Import into my books"} />}
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">What will change</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <caption className="sr-only">Records by change type</caption>
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Records</th>
                  <th className="py-2 pr-3 text-right">New</th>
                  <th className="py-2 pr-3 text-right">Changed</th>
                  <th className="py-2 pr-3 text-right">Unchanged</th>
                  <th className="py-2 text-right">Removed at source</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.entities).map(([entity, c]) => (
                  <tr key={entity} className="border-t border-mist-light">
                    <td className="py-2 pr-3">{ENTITY_LABELS[entity] ?? entity}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCount(c.new)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCount(c.changed)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCount(c.unchanged)}</td>
                    <td className="py-2 text-right tabular-nums">{formatCount(c.deletedAtSource)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">Reconciliation with your accounts</h3>
          <p className="mt-1 text-sm text-graphite">
            {reconciliation.length > 0 ? "Totals now in the database, checked against the control totals before saving." : "Rows in the files, checked against the control totals you supplied."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-sm">
              <caption className="sr-only">Control totals</caption>
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3 text-right">Your accounts</th>
                  <th className="py-2 pr-3 text-right">{reconciliation.length > 0 ? "In database" : "In files"}</th>
                  <th className="py-2 text-right">Match</th>
                </tr>
              </thead>
              <tbody>
                {(reconciliation.length > 0
                  ? reconciliation.map((r) => ({ metric: r.metric, stated: r.expected, actual: r.inDatabase, ok: r.ok }))
                  : summary.controlTotals.map((r) => ({ metric: r.metric, stated: r.stated, actual: r.computed, ok: r.ok }))
                ).map((r) => (
                  <tr key={r.metric} className="border-t border-mist-light">
                    <td className="py-2 pr-3">{METRIC_LABELS[r.metric] ?? r.metric}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatInr(r.stated)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatInr(r.actual)}</td>
                    <td className={`py-2 text-right font-semibold ${r.ok ? "text-forest" : "text-terracotta"}`}>{r.ok ? "✓ Matches" : "✗ Differs"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">
          Issues {issueTotal > 0 && <span className="text-base text-graphite">({formatCount(summary.issues.errors)} errors, {formatCount(summary.issues.warnings)} warnings)</span>}
        </h3>
        {issueTotal === 0 ? (
          <p className="mt-2 text-sm text-forest">No issues found.</p>
        ) : (
          <>
            <ul className="mt-3 flex flex-wrap gap-2">
              {Object.entries(summary.issues.byCode).map(([code, c]) => (
                <li key={code} className={`rounded-full border px-3 py-1 text-xs font-semibold ${c.severity === "error" ? "border-terracotta text-terracotta" : "border-mustard text-ink"}`}>
                  {code.replace(/_/g, " ").toLowerCase()} · {formatCount(c.count)}
                </li>
              ))}
            </ul>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <caption className="sr-only">Issues, errors first</caption>
                <thead className="text-xs uppercase tracking-wide text-graphite">
                  <tr>
                    <th className="py-2 pr-3">Severity</th>
                    <th className="py-2 pr-3">Where</th>
                    <th className="py-2">What</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.issues.map((issue) => (
                    <tr key={issue.id} className="border-t border-mist-light align-top">
                      <td className={`py-2 pr-3 font-semibold ${issue.severity === "error" ? "text-terracotta" : "text-graphite"}`}>{issue.severity}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {issue.rowRef ?? issue.entity}
                        {issue.field && ` · ${issue.field}`}
                      </td>
                      <td className="py-2">{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {issueTotal > batch.issues.length && <p className="mt-2 text-xs text-graphite">Showing the first {batch.issues.length} of {formatCount(issueTotal)} issues.</p>}
          </>
        )}
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h3 className="font-display text-xl">Files</h3>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {summary.files.map((f) => (
            <li key={f.name} className="flex justify-between gap-3 border-b border-mist-light pb-2">
              <span className="font-mono">{f.name}</span>
              <span className="text-graphite">{plural(f.rows, "row", "rows")}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type AdapterDetails = {
  company?: string | null;
  vouchersRead?: number;
  imported?: Record<string, number>;
  skipped?: Record<string, { count: number; examples: string[] }>;
  charges?: number;
  lines?: number;
  deposits?: { settlementId: string; depositDate: string; total: string }[];
  columnsUsed?: Record<string, string>;
};

/** What a file adapter did, and that it is not verified against real exports yet. */
function AdapterNote({ adapter }: { adapter: NonNullable<ImportSummary["adapter"]> }) {
  const d = adapter.details as AdapterDetails;
  const skipped = Object.entries(d.skipped ?? {});
  const lines: string[] = [];
  if (d.vouchersRead !== undefined) {
    const imported = Object.values(d.imported ?? {}).reduce((s, n) => s + n, 0);
    lines.push(`${d.company ? `${d.company}: ` : ""}${imported} of ${d.vouchersRead} vouchers converted.`);
    if (skipped.length > 0) lines.push(`Not imported: ${skipped.map(([reason, s]) => `${s.count} × ${reason}`).join("; ")}.`);
  }
  if (d.charges !== undefined) lines.push(`${d.charges} charge line(s) converted.`);
  for (const dep of d.deposits ?? []) lines.push(`Settlement ${dep.settlementId}: deposit of ₹${dep.total} on ${dep.depositDate} reconciled to its rows.`);
  if (d.lines !== undefined) lines.push(`${d.lines} purchase order line(s) converted.`);
  if (d.columnsUsed) lines.push(`Columns used: ${Object.entries(d.columnsUsed).map(([k, v]) => `${k} ← "${v}"`).join("; ")}.`);
  return (
    <div role="note" className="mt-3 max-w-2xl rounded-xl2 border border-mustard bg-mustard/15 p-3 text-sm">
      <p>
        <strong>{adapter.name}.</strong> {adapter.note}
      </p>
      {lines.map((l) => (
        <p key={l} className="mt-1 text-graphite">
          {l}
        </p>
      ))}
    </div>
  );
}
