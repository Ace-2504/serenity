import { METRICS } from "@/server/metrics/registry";

export default function MetricsPage() {
  return (
    <section className="rounded-xl2 border border-mist bg-canvas p-5">
      <h2 className="font-display text-2xl">How every number is calculated</h2>
      <p className="mt-1 max-w-3xl text-sm text-graphite">
        Amounts exclude GST unless stated. When the data needed for a figure is missing, the figure is marked partial or not available instead of being estimated.
      </p>
      <dl className="mt-4 divide-y divide-mist-light">
        {METRICS.map((m) => (
          <div key={m.id} id={m.id} className="scroll-mt-24 py-3 target:bg-paper">
            <dt className="font-semibold">
              {m.label} <span className="font-mono text-xs font-normal text-graphite">{m.id}</span>
            </dt>
            <dd className="mt-1 text-sm">{m.formula}</dd>
            {m.notes && <dd className="mt-1 text-sm text-graphite">{m.notes}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}
