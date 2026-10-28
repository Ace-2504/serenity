import type { Route } from "next";
import Link from "next/link";
import type { FindingStatus } from "@prisma/client";
import { FindingActions } from "@/components/bi/finding-actions";
import { formatDate, formatDateTime, formatInrCompact, formatPct } from "@/components/bi/format";
import { Onboarding } from "@/components/bi/onboarding";
import { fullDemoAllowed } from "@/server/bi/demo";
import { RefreshFindingsButton } from "@/components/bi/refresh-findings-button";
import { StatTile } from "@/components/bi/stat-tile";
import { stockPositions } from "@/server/analytics/inventory";
import { dataSpan, pct, profitability } from "@/server/analytics/profitability";
import { openBills, sumPending } from "@/server/analytics/working-capital";
import { CAN_DECIDE, CAN_IMPORT, getBiContext } from "@/server/bi/context";
import { shift } from "@/server/findings/context";
import { trackRecord } from "@/server/findings/engine";
import { bySeverityThenImpact, entityHref, RULE_LABELS, SEVERITY_STYLES, STATUS_LABELS } from "@/server/findings/present";

export const dynamic = "force-dynamic";

const TABS: { status: FindingStatus; label: string }[] = [
  { status: "open", label: "Needs a decision" },
  { status: "accepted", label: "Accepted" },
  { status: "snoozed", label: "Snoozed" },
  { status: "dismissed", label: "Dismissed" },
  { status: "resolved", label: "Gone away" }
];

function delta(now: number | null, then: number | null, unit: "pct" | "pp") {
  if (now === null || then === null || then === 0) return undefined;
  const d = unit === "pct" ? ((now - then) / Math.abs(then)) * 100 : now - then;
  return `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)}${unit === "pct" ? "%" : " pts"} vs same 90 days last year`;
}

export default async function Overview({ searchParams }: { searchParams: { status?: string; all?: string } }) {
  const resolved = await getBiContext();
  const bi = resolved?.context;
  if (!bi) return <Onboarding canCreate={resolved?.sessionRoles.includes("owner_admin") ?? false} fullDemo={fullDemoAllowed()} />;
  const span = await dataSpan(bi.db);
  if (!span) {
    return (
      <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">
        No data yet. <Link href="/admin/erp/imports" className="underline">Import your accounts</Link> or load the demo to see the overview.
      </p>
    );
  }

  const status = (TABS.find((t) => t.status === searchParams.status)?.status ?? "open") as FindingStatus;
  const now = { from: shift(span.to, -89), to: span.to };
  const then = { from: shift(now.from, -365), to: shift(span.to, -365) };
  const [[cur], [prev], positions, receivables, counts, findings, record, lastImport] = await Promise.all([
    profitability(bi.db, bi.tenant.id, now, "total"),
    profitability(bi.db, bi.tenant.id, then, "total"),
    stockPositions(bi.db, bi.tenant.id, span.to),
    openBills(bi.db, bi.tenant.id, "receivable", span.to),
    bi.db.finding.groupBy({ by: ["status"], _count: { _all: true } }),
    bi.db.finding.findMany({ where: { status }, include: { outcomes: true } }),
    trackRecord(bi.db),
    bi.db.importBatch.findFirst({ where: { status: "committed" }, orderBy: { committedAt: "desc" }, select: { committedAt: true } })
  ]);
  findings.sort(bySeverityThenImpact);
  const LIMIT = 10;
  const shown = searchParams.all === "1" ? findings : findings.slice(0, LIMIT);
  const count = (s: FindingStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const gm = (r: typeof cur | undefined) => (r ? pct(r.grossProfit, r.netSalesKnownCost) : null);
  const stock = [...positions.values()].reduce((s, p) => s + (p.qty.gt(0) ? (p.value?.toNumber() ?? 0) : 0), 0);
  const canDecide = CAN_DECIDE.includes(bi.role);
  const neverChecked = counts.length === 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-graphite">
        Data up to <strong className="text-ink">{formatDate(span.to)}</strong>
        {lastImport?.committedAt && <> · last import {formatDateTime(lastImport.committedAt)}</>}. Figures exclude GST; stock is at cost.
      </p>

      <section aria-label="Last 90 days" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Net sales, last 90 days"
          value={formatInrCompact(cur?.netSales.toNumber() ?? 0)}
          sub={delta(cur?.netSales.toNumber() ?? null, prev?.netSales.toNumber() ?? null, "pct")}
          metricId="net_sales"
        />
        <StatTile
          label="Gross margin"
          value={formatPct(gm(cur))}
          sub={delta(gm(cur), gm(prev), "pp")}
          status={cur && cur.costCoverage < 1 ? "partial" : "ok"}
          note={cur && cur.costCoverage < 1 ? `cost known for ${(cur.costCoverage * 100).toFixed(0)}% of sales` : undefined}
          metricId="gross_margin_pct"
        />
        <StatTile label="Money in stock" value={formatInrCompact(stock)} sub={`as on ${formatDate(span.to)}`} metricId="inventory_value" />
        <StatTile
          label="Customers owe you"
          value={formatInrCompact(sumPending(receivables))}
          sub={`${formatInrCompact(sumPending(receivables.filter((b) => b.daysOverdue > 0)))} overdue`}
          metricId="ar_total"
        />
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">What needs your attention</h2>
            <p className="mt-1 text-sm text-graphite">
              Problems and opportunities found by fixed rules on your own books, largest first. Rupee figures are estimates; each one shows how it was worked out.
            </p>
          </div>
          {CAN_IMPORT.includes(bi.role) ? <RefreshFindingsButton label={neverChecked ? "Check for problems now" : "Check again"} /> : null}
        </div>

        <nav aria-label="Filter recommendations" className="mt-4 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.status}
              href={`/admin/erp?status=${t.status}` as Route}
              aria-current={t.status === status ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${t.status === status ? "border-ink bg-ink text-canvas" : "border-mist hover:border-ink"}`}
            >
              {t.label} ({count(t.status)})
            </Link>
          ))}
        </nav>

        {findings.length === 0 ? (
          <p className="mt-4 text-sm text-graphite">{neverChecked ? "Not checked yet. Findings are refreshed after every import." : "Nothing here."}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {shown.map((f) => {
              const href = entityHref(f.entityType, f.entityId);
              return (
                <li key={f.id} className="rounded-xl2 border border-mist p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full border px-2 py-0.5 font-semibold uppercase ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                    <span className="text-graphite">{RULE_LABELS[f.ruleId] ?? f.ruleId}</span>
                    {href && (
                      <Link href={href as Route} className="text-graphite underline-offset-2 hover:underline">
                        {f.entityLabel}
                      </Link>
                    )}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-ink">
                    <Link href={`/admin/erp/findings/${f.id}` as Route} className="underline-offset-2 hover:underline">
                      {f.title}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm text-graphite">{f.whyItMatters}</p>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">Suggested: </span>
                    {f.suggestedAction}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-graphite">
                      {f.impactInr ? <>Estimated impact {formatInrCompact(f.impactInr.toNumber())} · </> : null}
                      <Link href={`/admin/erp/findings/${f.id}` as Route} className="underline">
                        evidence and how it was worked out
                      </Link>
                      {f.status !== "open" && <> · {STATUS_LABELS[f.status]}</>}
                    </p>
                    <FindingActions findingId={f.id} status={f.status} canDecide={canDecide} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {shown.length < findings.length && (
          <Link href={`/admin/erp?status=${status}&all=1` as Route} className="mt-4 inline-block rounded-full border border-ink px-4 py-1.5 text-sm font-semibold hover:bg-paper">
            Show all {findings.length}
          </Link>
        )}
      </section>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Track record</h2>
        <p className="mt-1 text-sm text-graphite">
          How recommendations have fared. Estimates and measured results are shown apart and never added together; a measured change shows what happened, not proof
          that the action caused it.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-graphite">Decided</dt>
            <dd className="text-xl font-semibold">
              {record.decided} of {record.raised}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-graphite">Accepted</dt>
            <dd className="text-xl font-semibold">{record.acceptanceRate === null ? "—" : `${Math.round(record.acceptanceRate * 100)}%`}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-graphite">Estimated, accepted items</dt>
            <dd className="text-xl font-semibold">{formatInrCompact(record.estimatedImpactAccepted)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-graphite">Measured so far</dt>
            <dd className="text-xl font-semibold">
              {record.measured === 0 ? "—" : `${record.achieved} of ${record.measured} on target · ${formatInrCompact(record.realisedImpact)}`}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
