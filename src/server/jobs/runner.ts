import { randomUUID } from "node:crypto";
import type { Job, Prisma } from "@prisma/client";
import { loadDemoData, type DemoSize } from "@/server/bi/demo";
import { forTenant } from "@/server/db/tenant";
import { measureOutcomes, refreshFindings } from "@/server/findings/engine";
import { commitImport, ImportError } from "@/server/ingest/pipeline";
import { sendCampaign } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";
import { MlUnavailableError, runMlWorker } from "@/server/ml/worker";
import { claimJob, completeJob, enqueueJob, failJob, requeueStale, setProgress, type JobType } from "@/server/jobs/queue";

/**
 * Job handlers and the loop that runs them. JOBS_MODE=worker leaves jobs to `npm run worker`;
 * otherwise the web process drains the queue itself after enqueueing (fine for one server or
 * Docker; on serverless hosts a frozen function is recovered by stale-lock requeueing).
 */

const STEP_LABELS: Record<string, string> = {
  generate: "Generating demo data",
  stage: "Checking the files",
  source_records: "Saving source records",
  masters: "Saving items and parties",
  vouchers: "Saving vouchers",
  lines: "Saving voucher lines",
  charges: "Saving channel charges",
  customer_orders: "Saving customer purchase orders",
  deletions: "Marking deleted vouchers",
  snapshots: "Saving stock and outstanding snapshots",
  ledger: "Rebuilding the stock ledger",
  reconcile: "Reconciling totals",
  findings: "Looking for problems and opportunities",
  ml: "Training and testing the prediction models",
  campaign: "Sending the approved campaign"
};

type Handler = (job: Job, progress: (step: string) => void) => Promise<Prisma.InputJsonValue>;

async function afterDataChange(tenantId: string, progress: (step: string) => void) {
  progress("findings");
  const db = forTenant(tenantId);
  const findings = await refreshFindings(db, tenantId);
  const outcomes = await measureOutcomes(db, tenantId);
  // Models retrain after imports only when switched on, so imports never depend on Python being installed.
  if (process.env.ML_AUTORUN === "1") await enqueueJob(tenantId, "ml.run", {}, { dedupeKey: "ml.run" });
  return { findings, outcomes };
}

const HANDLERS: Record<JobType, Handler> = {
  "import.commit": async (job, progress) => {
    const { batchId, userId } = job.payload as { batchId: string; userId?: string };
    const committed = await commitImport(forTenant(job.tenantId), job.tenantId, batchId, { userId, onStep: progress });
    return { batchId, durationMs: committed.durationMs, reconciliation: committed.reconciliation, ...(await afterDataChange(job.tenantId, progress)) } as Prisma.InputJsonValue;
  },
  "demo.load": async (job, progress) => {
    const { size, userId } = job.payload as { size: DemoSize; userId?: string };
    const loaded = await loadDemoData(job.tenantId, size, userId, progress);
    return { ...loaded, ...(await afterDataChange(job.tenantId, progress)) } as Prisma.InputJsonValue;
  },
  "findings.refresh": async (job, progress) => afterDataChange(job.tenantId, progress) as Promise<Prisma.InputJsonValue>,
  "campaign.send": async (job, progress) => {
    progress("campaign");
    const { campaignId } = job.payload as { campaignId: string };
    return sendCampaign(forTenant(job.tenantId), job.tenantId, campaignId, process.env.APP_URL ?? "http://localhost:3000");
  },
  "ml.run": async (job, progress) => {
    progress("ml");
    return (await runMlWorker(job.tenantId)) as Prisma.InputJsonValue;
  }
};

/** Data errors (failed validation, reconciliation) and a missing ML install will fail again; anything else may be transient. */
const isRetryable = (error: unknown) => !(error instanceof ImportError || error instanceof MlUnavailableError || error instanceof WorkflowError);

export async function runJob(job: Job): Promise<void> {
  const handler = HANDLERS[job.type as JobType];
  if (!handler) return failJob(job, `Unknown job type ${job.type}`, false);
  let last = "";
  const progress = (step: string) => {
    const label = STEP_LABELS[step] ?? step;
    if (label === last) return;
    last = label;
    void setProgress(job.id, label).catch(() => undefined);
  };
  try {
    await completeJob(job.id, await handler(job, progress));
  } catch (error) {
    const message = error instanceof ImportError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
    if (!(error instanceof ImportError)) console.error(`job ${job.id} (${job.type}) failed`, error);
    await failJob(job, message, isRetryable(error));
  }
}

/** Runs queued jobs until none is runnable. Returns how many ran. */
export async function drainJobs(workerId = `web-${randomUUID().slice(0, 8)}`): Promise<number> {
  await requeueStale();
  let ran = 0;
  for (let job = await claimJob(workerId); job; job = await claimJob(workerId)) {
    await runJob(job);
    ran += 1;
  }
  return ran;
}

let draining: Promise<number> | null = null;

/** Starts draining in the background unless a dedicated worker is configured. Never throws. */
export function kickJobs(): void {
  if (process.env.JOBS_MODE === "worker" || draining) return;
  draining = drainJobs()
    .catch((error) => {
      console.error("job drain failed", error);
      return 0;
    })
    .finally(() => {
      draining = null;
    });
}
