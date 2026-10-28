import { formatCount, formatDate, formatDateTime, formatPct } from "@/components/bi/format";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";
import { databaseHealth, systemStatus } from "@/server/ops/status";

export const dynamic = "force-dynamic";

const JOB_LABELS: Record<string, string> = {
  "import.commit": "Import commit",
  "demo.load": "Demo load",
  "findings.refresh": "Findings refresh",
  "ml.run": "Model training",
  "campaign.send": "Campaign send"
};
const seconds = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)} s` : `${(s / 60).toFixed(1)} min`);
const Th = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <th className={`py-2 pr-3 font-semibold ${right ? "text-right" : ""}`}>{children}</th>;
const Td = ({ children, right = false }: { children: React.ReactNode; right?: boolean }) => <td className={`py-1.5 pr-3 align-top ${right ? "text-right tabular-nums" : ""}`}>{children}</td>;
const Panel = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <section className="rounded-xl2 border border-mist bg-canvas p-5">
    <h3 className="font-display text-xl">{title}</h3>
    {note && <p className="mt-1 text-sm text-graphite">{note}</p>}
    <div className="mt-3">{children}</div>
  </section>
);

export default async function SystemPage() {
  const bi = (await getBiContext())?.context;
  if (!bi) return null;
  if (!CAN_IMPORT.includes(bi.role)) {
    return <p className="rounded-xl2 border border-mist bg-canvas p-5 text-sm">The system page is for the owner and the accountant.</p>;
  }
  const [s, db] = await Promise.all([systemStatus(bi.db, bi.tenant.id), databaseHealth()]);
  const imports = s.imports.last30Days;

  return (
    <div className="space-y-4">
      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">System</h2>
        <p className="mt-1 max-w-3xl text-sm text-graphite">
          How the platform is running for this business: imports, background work, assistant answers, models and messages. Counts and timings only.
        </p>
        <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <li>Database: {db.ok ? `reachable (${db.ms} ms)` : `not reachable (${db.error})`}</li>
          <li>Background work runs {s.settings.jobsMode}</li>
          <li>Email: {s.settings.emailTransport}</li>
          <li>
            Model server: {s.settings.modelServer}
            {s.settings.model ? `, model ${s.settings.model}` : ""}
          </li>
          <li>Retrain models after each import: {s.settings.mlAutorun ? "yes" : "no"}</li>
          <li>Client addresses from a reverse proxy: {s.settings.trustProxy ? "trusted" : "not used"}</li>
        </ul>
      </section>

      <Panel title="Imports" note={`Last 30 days: ${formatCount(imports.committed ?? 0)} committed, ${formatCount(imports.failed ?? 0)} failed, ${formatCount(imports.rejected ?? 0)} rejected, ${formatCount((imports.staged ?? 0) + (imports.validated ?? 0))} awaiting review.`}>
        {s.imports.sources.length === 0 ? (
          <p className="text-sm text-graphite">No data sources yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-mist text-left text-graphite">
                <tr>
                  <Th>Source</Th>
                  <Th>Kind</Th>
                  <Th>Last committed</Th>
                  <Th>File</Th>
                </tr>
              </thead>
              <tbody>
                {s.imports.sources.map((src) => (
                  <tr key={`${src.name}-${src.kind}`} className="border-b border-mist/60">
                    <Td>
                      {src.name}
                      {src.isDemo ? " (demo)" : ""}
                    </Td>
                    <Td>{src.kind.replace(/_/g, " ")}</Td>
                    <Td>{formatDateTime(src.lastCommittedAt)}</Td>
                    <Td>{src.lastFile ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Background work (last 7 days)"
        note={s.jobs.oldestQueued ? `Oldest waiting: ${JOB_LABELS[s.jobs.oldestQueued.type] ?? s.jobs.oldestQueued.type}, for ${seconds(s.jobs.oldestQueued.waitingSec)}.` : "Nothing is waiting."}
      >
        {s.jobs.last7Days.length === 0 ? (
          <p className="text-sm text-graphite">No background work in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-mist text-left text-graphite">
                <tr>
                  <Th>Work</Th>
                  <Th right>Done</Th>
                  <Th right>Failed</Th>
                  <Th right>Waiting or running</Th>
                  <Th right>Median time</Th>
                  <Th right>Slowest 10%</Th>
                </tr>
              </thead>
              <tbody>
                {s.jobs.last7Days.map((j) => (
                  <tr key={j.type} className="border-b border-mist/60">
                    <Td>{JOB_LABELS[j.type] ?? j.type}</Td>
                    <Td right>{formatCount(j.done)}</Td>
                    <Td right>{formatCount(j.failed)}</Td>
                    <Td right>{formatCount(j.queued + j.running)}</Td>
                    <Td right>{seconds(j.medianSec)}</Td>
                    <Td right>{seconds(j.p90Sec)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-graphite">Time is from the request to the finish, including any wait in the queue.</p>
          </div>
        )}
        {s.jobs.recentFailures.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {s.jobs.recentFailures.map((f) => (
              <li key={f.id} className="text-terracotta">
                {JOB_LABELS[f.type] ?? f.type} failed {formatDateTime(f.finishedAt)} after {f.attempts} attempt{f.attempts === 1 ? "" : "s"}: {f.error ?? "no message"}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Assistant (30 days)">
          <ul className="space-y-1 text-sm">
            <li>{formatCount(s.assistant.questions)} questions</li>
            <li>
              {formatCount(s.assistant.byMode.llm ?? 0)} answered by the model, {formatCount(s.assistant.byMode.template ?? 0)} from report templates,{" "}
              {formatCount(s.assistant.byMode.unsupported ?? 0)} declined
            </li>
            <li>
              Model answers withheld by the number check: {formatCount(s.assistant.guardFailed)} of {formatCount(s.assistant.guardChecked)}
              {s.assistant.guardFailureRate !== null ? ` (${formatPct(s.assistant.guardFailureRate * 100)})` : ""}
            </li>
            <li>Average answer time: {s.assistant.avgLatencyMs === null ? "—" : seconds(s.assistant.avgLatencyMs / 1000)}</li>
          </ul>
        </Panel>
        <Panel title="Models">
          {s.models.length === 0 ? (
            <p className="text-sm text-graphite">Not trained yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {s.models.map((m) => (
                <li key={m.model}>
                  {m.model.replace(/_/g, " ")}: using {m.shipped.replace(/_/g, " ")}, trained {formatDate(m.trainedAt)} on data to {formatDate(m.dataCutoff)}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Messages (30 days)">
          <ul className="space-y-1 text-sm">
            <li>{formatCount(s.outbox.held ?? 0)} kept in the local outbox (not sent)</li>
            <li>{formatCount(s.outbox.sent ?? 0)} sent by email</li>
            <li>{formatCount(s.outbox.failed ?? 0)} failed</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
