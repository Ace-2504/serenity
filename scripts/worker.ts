/**
 * Dedicated job worker: `npm run worker` (set JOBS_MODE=worker on the web process so it only
 * enqueues). Polls the Postgres queue; several workers can run side by side.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
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

async function main() {
  console.log(`${workerId}: polling every ${POLL_MS} ms`);
  while (!stopping) {
    const ran = await drainJobs(workerId).catch((error) => {
      console.error(`${workerId}: drain failed`, error);
      return 0;
    });
    if (ran === 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  await prisma.$disconnect();
}

void main();
