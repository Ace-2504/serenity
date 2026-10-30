import type { Route } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { formatDate, formatInrCompact, formatPct } from "@/components/bi/format";
import { JobButton } from "@/components/bi/job-button";
import { stockPositions } from "@/server/analytics/inventory";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";

export const dynamic = "force-dynamic";

type FoldMetrics = { auc: number; brier: number; top_decile_lift: number; base_rate: number; n: number };
type RepeatMetrics = { folds: (Record<string, FoldMetrics | string | number> & { cutoff: string })[]; summary: { mean_auc: Record<string, number>; best_baseline: string; model_wins_folds: number; folds: number; rule: string; horizon_days: number } };
type ForecastMetrics = { methods: Record<string, { mean_mase: number; median_mase: number }>; best: string; baseline: string; gain_over_baseline: number; items_evaluated: number; weeks: number; rule: string; backtest: string };
type Factor = { label: string; direction: string };

const METHOD_LABELS: Record<string, string> = {
  model: "Model (logistic regression)",
  recency: "Baseline: most recent buyers first",
  rfm: "Baseline: RFM score",
  last_year_same_window: "Baseline: bought in this season last year",
  naive: "Last week repeated",
  seasonal_naive: "Same week last year (baseline)",
  moving_average_8: "8-week average",
  ses: "Exponential smoothing",
  croston: "Croston (intermittent demand)",
  sba: "Croston, bias-corrected (SBA)"
};
const label = (m: string) => METHOD_LABELS[m] ?? m;
const Th = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <th className={`py-2 pr-3 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
const Td = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <td className={`py-1.5 pr-3 align-top ${right ? "text-right tabular-nums" : ""}`}>{children}</td>;

export default async function PredictionsPage() {
  const bi = (await getBiContext())?.context;
  if (!bi) return null;
  const versions = await bi.db.modelVersion.findMany({ where: { status: "active" } });
  const repeat = versions.find((v) => v.model === "repeat_purchase");
  const fc = versions.find((v) => v.model === "demand_forecast");
  const basket = versions.find((v) => v.model === "basket_pairs");
  const canRun = CAN_IMPORT.includes(bi.role);

  const header = (
    <section className="flex flex-wrap items-end justify-between gap-3 rounded-xl2 border border-mist bg-canvas p-5">
      <div className="max-w-3xl">
        <h2 className="font-display text-2xl">Predictions</h2>
        <p className="mt-1 text-sm text-graphite">
          Estimates about the future, learned from your history. Each model is tested on past months it did not see, against simple rules; when it does not beat them, the
          simple rule is used and this page says so. These are probabilities, not figures from your books.
        </p>
        {repeat && <p className="mt-1 text-xs text-graphite">Last trained {formatDate(repeat.trainedAt)} on data up to {formatDate(repeat.dataCutoff)}.</p>}
      </div>
      {canRun && <JobButton url="/api/bi/ml/run" label={versions.length ? "Retrain now" : "Train the models"} busyLabel="Training…" />}
    </section>
  );
  if (versions.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm text-graphite">No models trained yet for this business.</p>
      </div>
    );
  }

  // Repeat purchase: valuable customers unlikely to order soon.
  let atRisk: { partyId: string; name: string; score: number; factors: Factor[]; lifetime: number; last: Date | null }[] = [];
  if (repeat) {
    atRisk = await bi.db.$queryRaw<typeof atRisk>(Prisma.sql`
      SELECT p."entityId" AS "partyId", pa."name", p."score", p."factors", COALESCE(SUM(v."taxableAmount"), 0)::float AS lifetime, MAX(v."date") AS last
      FROM "Prediction" p
      JOIN "Party" pa ON pa."tenantId" = p."tenantId" AND pa."id" = p."entityId"
      LEFT JOIN "Voucher" v ON v."tenantId" = p."tenantId" AND v."partyId" = p."entityId" AND v."type" = 'sales_invoice' AND v."status" = 'active'
      WHERE p."tenantId" = ${bi.tenant.id} AND p."modelVersionId" = ${repeat.id} AND p."score" < 0.35
      GROUP BY 1, 2, 3, 4
      ORDER BY lifetime DESC
      LIMIT 20`);
  }
  const rm = repeat?.metrics as RepeatMetrics | undefined;
  const methods = rm ? Object.keys(rm.summary.mean_auc) : [];
  const meanOf = (m: string, k: keyof FoldMetrics) => (rm ? rm.folds.reduce((s, f) => s + ((f[m] as FoldMetrics)?.[k] ?? 0), 0) / rm.folds.length : 0);

  // Demand forecast vs stock on hand.
  const fm = fc?.metrics as ForecastMetrics | undefined;
  let cover: { itemId: string; name: string; weekly: number; onHand: number; weeks: number | null }[] = [];
  if (fc) {
    const [points, positions, items] = await Promise.all([
      bi.db.forecastPoint.groupBy({ by: ["itemId"], where: { modelVersionId: fc.id }, _sum: { qty: true }, _count: { _all: true } }),
      stockPositions(bi.db, bi.tenant.id, fc.dataCutoff.toISOString().slice(0, 10)),
      bi.db.item.findMany({ select: { id: true, name: true } })
    ]);
    const names = new Map(items.map((i) => [i.id, i.name]));
    cover = points
      .map((p) => {
        const weekly = (p._sum.qty ?? 0) / Math.max(1, p._count._all);
        const onHand = Math.max(0, positions.get(p.itemId)?.qty.toNumber() ?? 0);
        return { itemId: p.itemId, name: names.get(p.itemId) ?? "—", weekly, onHand, weeks: weekly > 0 ? onHand / weekly : null };
      })
      .filter((c) => c.weeks !== null && c.weeks < 3 && c.weekly >= 1)
      .sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0))
      .slice(0, 20);
  }

  // Basket pairs.
  const pairs = basket
    ? await bi.db.$queryRaw<{ a: string; b: string; together: number; confidence: number; lift: number }[]>(Prisma.sql`
        SELECT ia."name" AS a, ib."name" AS b, bp."together", bp."confidence", bp."lift"
        FROM "BasketPair" bp
        JOIN "Item" ia ON ia."tenantId" = bp."tenantId" AND ia."id" = bp."itemId"
        JOIN "Item" ib ON ib."tenantId" = bp."tenantId" AND ib."id" = bp."partnerItemId"
        WHERE bp."tenantId" = ${bi.tenant.id} AND bp."modelVersionId" = ${basket.id} AND bp."together" >= 10 AND bp."itemId" < bp."partnerItemId"
        ORDER BY bp."lift" DESC, bp."together" DESC
        LIMIT 15`)
    : [];

  return (
    <div className="space-y-6">
      {header}

      {repeat && rm && (
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">Will they order in the next {rm.summary.horizon_days} days?</h3>
          <p className="mt-1 text-sm text-graphite">
            {repeat.shipped === "model"
              ? `The model ranked customers better than every simple rule on ${rm.summary.model_wins_folds} of ${rm.summary.folds} held-out periods, so its scores are used.`
              : `The model did not beat "${label(repeat.shipped)}" by enough (it needs +0.01 AUC and a majority of periods), so that rule's scores are used instead.`}{" "}
            Tested on {rm.folds.map((f) => f.cutoff).join(", ")}.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <Th>Method</Th>
                  <Th right>Ranking (AUC)</Th>
                  <Th right>Calibration (Brier, lower is better)</Th>
                  <Th right>Top 10% hit rate vs average</Th>
                </tr>
              </thead>
              <tbody>
                {methods.map((m) => (
                  <tr key={m} className={`border-t border-mist-light ${m === repeat.shipped ? "font-semibold" : ""}`}>
                    <Td>
                      {label(m)}
                      {m === repeat.shipped && " ✓ in use"}
                    </Td>
                    <Td right>{rm.summary.mean_auc[m].toFixed(3)}</Td>
                    <Td right>{meanOf(m, "brier").toFixed(3)}</Td>
                    <Td right>{meanOf(m, "top_decile_lift").toFixed(2)}×</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 className="mt-5 font-semibold">Valuable customers unlikely to order soon</h4>
          {atRisk.length === 0 ? (
            <p className="mt-2 text-sm text-graphite">No valuable customer has a low chance of ordering.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-graphite">
                  <tr>
                    <Th>Customer</Th>
                    <Th right>Chance of an order</Th>
                    <Th right>Bought to date</Th>
                    <Th>Why</Th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((c) => (
                    <tr key={c.partyId} className="border-t border-mist-light">
                      <Td>
                        <Link href={`/admin/crm/customers/${c.partyId}` as Route} className="underline-offset-2 hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-graphite">last order {formatDate(c.last)}</div>
                      </Td>
                      <Td right>{formatPct(c.score * 100)}</Td>
                      <Td right>{formatInrCompact(c.lifetime)}</Td>
                      <Td>{c.factors.map((f) => f.label).join("; ")}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {fc && fm && (
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">Demand for the next weeks</h3>
          <p className="mt-1 text-sm text-graphite">
            {fc.shipped === fm.baseline
              ? `No method beat "same week last year" by 2% or more on ${fm.items_evaluated} products (${fm.backtest}), so that simple rule is used.`
              : `"${label(fc.shipped)}" beat "same week last year" by ${(fm.gain_over_baseline * 100).toFixed(1)}% on ${fm.items_evaluated} products (${fm.backtest}), so it is used.`}{" "}
            Accuracy is MASE: 1.0 means as good as repeating last week; lower is better.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <Th>Method</Th>
                  <Th right>Mean MASE</Th>
                  <Th right>Median MASE</Th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(fm.methods)
                  .sort((a, b) => a[1].mean_mase - b[1].mean_mase)
                  .map(([m, v]) => (
                    <tr key={m} className={`border-t border-mist-light ${m === fc.shipped ? "font-semibold" : ""}`}>
                      <Td>
                        {label(m)}
                        {m === fc.shipped && " ✓ in use"}
                      </Td>
                      <Td right>{v.mean_mase.toFixed(3)}</Td>
                      <Td right>{v.median_mase.toFixed(3)}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <h4 className="mt-5 font-semibold">Products likely to run out within three weeks</h4>
          {cover.length === 0 ? (
            <p className="mt-2 text-sm text-graphite">No product is forecast to run out within three weeks.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-graphite">
                  <tr>
                    <Th>Product</Th>
                    <Th right>Forecast per week</Th>
                    <Th right>In stock</Th>
                    <Th right>Weeks of cover</Th>
                  </tr>
                </thead>
                <tbody>
                  {cover.map((c) => (
                    <tr key={c.itemId} className="border-t border-mist-light">
                      <Td>
                        <Link href={`/admin/erp/products/${c.itemId}` as Route} className="underline-offset-2 hover:underline">
                          {c.name}
                        </Link>
                      </Td>
                      <Td right>{c.weekly.toFixed(1)}</Td>
                      <Td right>{Math.round(c.onHand)}</Td>
                      <Td right>{(c.weeks ?? 0).toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {basket && (
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h3 className="font-display text-xl">Often bought together</h3>
          <p className="mt-1 text-sm text-graphite">
            Pairs on the same invoice in the last 12 months, at least 10 times. Lift 2.0 means the pair appears twice as often as chance. A counting statistic, not a model.
          </p>
          {pairs.length === 0 ? (
            <p className="mt-2 text-sm text-graphite">No pair was bought together often enough.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-graphite">
                  <tr>
                    <Th>Product</Th>
                    <Th>Bought with</Th>
                    <Th right>Invoices together</Th>
                    <Th right>Lift</Th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={`${p.a}|${p.b}`} className="border-t border-mist-light">
                      <Td>{p.a}</Td>
                      <Td>{p.b}</Td>
                      <Td right>{p.together}</Td>
                      <Td right>{p.lift.toFixed(2)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
