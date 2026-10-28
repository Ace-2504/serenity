import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FindingActions } from "@/components/bi/finding-actions";
import { formatDate, formatInrCompact } from "@/components/bi/format";
import { CAN_DECIDE, getBiContext } from "@/server/bi/context";
import type { MeasurePlan } from "@/server/findings/engine";
import { entityHref, formatMetric, RULE_LABELS, SEVERITY_STYLES, STATUS_LABELS, VERDICT_LABELS } from "@/server/findings/present";
import type { FindingDraft } from "@/server/findings/types";

export const dynamic = "force-dynamic";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl2 border border-mist bg-canvas p-5">
      <h2 className="font-display text-xl">
        <span className="mr-2 text-graphite">{n}.</span>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </section>
  );
}

export default async function FindingPage({ params }: { params: { findingId: string } }) {
  const bi = (await getBiContext())?.context;
  if (!bi) notFound();
  const f = await bi.db.finding.findFirst({ where: { id: params.findingId }, include: { outcomes: { orderBy: { measuredOn: "desc" } } } });
  if (!f) notFound();
  const evidence = f.evidence as FindingDraft["evidence"];
  const plan = f.measurePlan as MeasurePlan;
  const assumptions = f.assumptions as string[];
  const href = entityHref(f.entityType, f.entityId);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/admin/erp" className="text-sm underline">
        ← Back to the overview
      </Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 font-semibold uppercase ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
          <span className="rounded-full border border-mist px-2 py-0.5">{STATUS_LABELS[f.status]}</span>
          <span className="text-graphite">
            {RULE_LABELS[f.ruleId] ?? f.ruleId} · measured from your books by a fixed rule, as of {formatDate(f.asOf)}
          </span>
        </div>
        <h1 className="font-display text-3xl">{f.title}</h1>
        {href && (
          <Link href={href as Route} className="text-sm underline">
            Open {f.entityLabel}
          </Link>
        )}
      </header>

      <Section n={1} title="What happened">
        <p>{f.whatHappened}</p>
      </Section>

      <Section n={2} title="The evidence">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {evidence.facts.map((fact) => (
            <div key={fact.label} className="flex justify-between gap-3 border-t border-mist-light py-1">
              <dt className="text-graphite">{fact.label}</dt>
              <dd className="text-right font-semibold tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
        {evidence.table && (
          <div className="overflow-x-auto">
            <table className="mt-2 w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-graphite">
                  {evidence.table.columns.map((c, i) => (
                    <th key={c} className={`py-1 pr-3 font-semibold ${i > 0 ? "text-right" : ""}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evidence.table.rows.map((row, r) => (
                  <tr key={r} className="border-t border-mist-light">
                    {row.map((cell, i) => (
                      <td key={i} className={`py-1 pr-3 ${i > 0 ? "text-right tabular-nums" : ""}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section n={3} title="Why it matters">
        <p>{f.whyItMatters}</p>
      </Section>

      <Section n={4} title="What you could do">
        <p>{f.suggestedAction}</p>
        <p className="text-xs text-graphite">A suggestion only: nothing is changed, sent or ordered unless you do it.</p>
      </Section>

      <Section n={5} title="Estimated impact">
        <p className="text-2xl font-semibold">{f.impactInr ? formatInrCompact(f.impactInr.toNumber()) : "Not estimated in rupees"}</p>
        <p className="text-graphite">How: {f.impactFormula}</p>
      </Section>

      <Section n={6} title="Assumptions and limits">
        <ul className="list-disc space-y-1 pl-5">
          {assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Section>

      <Section n={7} title="How we will know if it worked">
        <p>
          {plan.label}: now <strong>{formatMetric(plan.metric, plan.baseline)}</strong>. Success if it {plan.successWhen}, checked {plan.checkAfterDays} days of data after you
          accept.
        </p>
        {plan.checkOn && (
          <p className="text-graphite">
            Accepted with data up to {formatDate(plan.startedOn!)}; will be checked once data reaches {formatDate(plan.checkOn)}.
          </p>
        )}
        {f.outcomes.map((o) => (
          <div key={o.id} className="rounded-xl2 border border-mist p-3">
            <p className="font-semibold">
              {VERDICT_LABELS[o.verdict] ?? o.verdict}: {formatMetric(plan.metric, o.metricValue?.toNumber())} on {formatDate(o.measuredOn)}
              {o.realisedImpactInr && <> · measured change {formatInrCompact(o.realisedImpactInr.toNumber())}</>}
            </p>
            <p className="mt-1 text-xs text-graphite">{o.notes}</p>
          </div>
        ))}
      </Section>

      <section className="rounded-xl2 border border-ink bg-paper p-5">
        <h2 className="font-display text-xl">Your decision</h2>
        {f.ownerNote && <p className="mt-1 text-sm text-graphite">Note: {f.ownerNote}</p>}
        <div className="mt-3">
          {f.status === "accepted" || f.status === "resolved" ? (
            <p className="text-sm text-graphite">{STATUS_LABELS[f.status]}.</p>
          ) : (
            <FindingActions findingId={f.id} status={f.status} canDecide={CAN_DECIDE.includes(bi.role)} withNote />
          )}
        </div>
      </section>
    </div>
  );
}
