/**
 * Dedicated job worker: `npm run worker` (set JOBS_MODE=worker on the web process so it only
 * enqueues). Polls the Postgres queue; several workers can run side by side.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { enqueueDueTallySyncs } from "@/server/adapters/tally/sync";
import { drainJobs } from "@/server/jobs/runner";

const workerId = `worker-${randomUUID().slice(0, 8)}`;
const POLL_MS = Number(process.env.JOBS_POLL_MS ?? 2000);
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log(`${workerId}: stopping after the current job`);
  });
}

/** How often to look for live sources due their daily sync. */
const SCHEDULE_MS = 15 * 60_000;

async function main() {
  console.log(`${workerId}: polling every ${POLL_MS} ms`);
  let lastSchedule = 0;
  while (!stopping) {
    if (Date.now() - lastSchedule >= SCHEDULE_MS) {
      lastSchedule = Date.now();
      const queued = await enqueueDueTallySyncs().catch((error) => {
        console.error(`${workerId}: scheduling Tally syncs failed`, error);
        return 0;
      });
      if (queued > 0) console.log(`${workerId}: queued ${queued} daily Tally sync(s)`);
    }
    const ran = await drainJobs(workerId).catch((error) => {
      console.error(`${workerId}: drain failed`, error);
      return 0;
    });
    if (ran === 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await prisma.$disconnect();
}

void main();
