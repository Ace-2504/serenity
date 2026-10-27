import Link from "next/link";
import { formatDate, formatDateTime } from "@/components/bi/format";
import { Onboarding } from "@/components/bi/onboarding";
import { StatusChip } from "@/components/bi/status-chip";
import { TallyConnect } from "@/components/bi/tally-connect";
import { AmazonSync } from "@/components/bi/amazon-sync";
import { RegisterUpload } from "@/components/bi/register-upload";
import { REGISTER_FIELDS, VOUCHER_TYPE_LABELS } from "@/server/adapters/register";
import { amazonConfigured } from "@/server/adapters/marketplace/sp-api";
import { UploadForm } from "@/components/bi/upload-form";
import { CAN_IMPORT, getBiContext } from "@/server/bi/context";

export default async function ImportsPage() {
  const resolved = await getBiContext();
  const bi = resolved?.context;
  if (!resolved || !bi) {
    return <Onboarding canCreate={resolved?.sessionRoles.includes("owner_admin") ?? false} />;
  }

  const [sources, batches] = await Promise.all([
    bi.db.dataSource.findMany({ orderBy: { createdAt: "asc" } }),
    bi.db.importBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { dataSource: { select: { name: true } } } })
  ]);
  const tally = sources.find((src) => src.kind === "tally_http");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        {bi.tenant.isDemo ? (
          <section className="space-y-4 rounded-xl2 border border-mist bg-canvas p-5">
            <h2 className="font-display text-2xl">Upload accounting data</h2>
            <p className="text-sm text-graphite">Uploads are switched off in a demo business: demo and real data are never mixed. Reload the demo, or create your own business to upload real exports.</p>
            <Onboarding canCreate={resolved.sessionRoles.includes("owner_admin")} stacked />
          </section>
        ) : CAN_IMPORT.includes(bi.role) ? (
          <section className="rounded-xl2 border border-mist bg-canvas p-5">
            <h2 className="font-display text-2xl">Upload accounting data</h2>
            <p className="mb-4 mt-1 text-sm text-graphite">
              Export from Tally, BUSY or a spreadsheet into the <Link href="/bi/template" className="underline">import template</Link>.
            </p>
            <UploadForm />
          </section>
        ) : (
          <p className="text-sm text-graphite">Your role ({bi.role}) can view imports but not upload.</p>
        )}
        {!bi.tenant.isDemo && CAN_IMPORT.includes(bi.role) && (
          <section className="rounded-xl2 border border-mist bg-canvas p-5">
            <h2 className="font-display text-2xl">Registers from BUSY or a spreadsheet</h2>
            <div className="mt-2">
              <RegisterUpload fields={REGISTER_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }))} voucherTypes={VOUCHER_TYPE_LABELS} />
            </div>
          </section>
        )}
        {!bi.tenant.isDemo && CAN_IMPORT.includes(bi.role) && (
          <section className="rounded-xl2 border border-mist bg-canvas p-5">
            <h2 className="font-display text-2xl">Live sync from TallyPrime</h2>
            <div className="mt-2">
              <TallyConnect initial={(tally?.settings as Parameters<typeof TallyConnect>[0]["initial"]) ?? null} connected={!!tally} />
            </div>
          </section>
        )}
        {!bi.tenant.isDemo && CAN_IMPORT.includes(bi.role) && (
          <section className="rounded-xl2 border border-mist bg-canvas p-5">
            <h2 className="font-display text-2xl">Amazon.in payouts</h2>
            <div className="mt-2">
              <AmazonSync configured={amazonConfigured()} />
            </div>
          </section>
        )}
        <section className="rounded-xl2 border border-mist bg-canvas p-5">
          <h2 className="font-display text-2xl">Data sources</h2>
          {sources.length === 0 ? (
            <p className="mt-2 text-sm text-graphite">No data sources yet. Your first upload creates one.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-mist-light pb-2 text-sm last:border-0">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-graphite">Last successful import: {formatDateTime(s.lastSuccessfulSyncAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl2 border border-mist bg-canvas p-5">
        <h2 className="font-display text-2xl">Import history</h2>
        {batches.length === 0 ? (
          <p className="mt-2 text-sm text-graphite">No imports yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <caption className="sr-only">Imports, newest first</caption>
              <thead className="text-xs uppercase tracking-wide text-graphite">
                <tr>
                  <th className="py-2 pr-3">Uploaded</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t border-mist-light">
                    <td className="py-2 pr-3">
                      <Link href={`/bi/imports/${b.id}`} className="font-semibold underline-offset-2 hover:underline">
                        {formatDateTime(b.createdAt)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">
                      {formatDate(b.periodFrom)} – {formatDate(b.periodTo)}
                    </td>
                    <td className="py-2 pr-3">{b.dataSource.name}</td>
                    <td className="py-2 pr-3">
                      <StatusChip status={b.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
