/**
 * Re-runs the findings rules and outcome measurement for one business, or all of them:
 *   npm run findings:refresh -- [tenantId] [asOf YYYY-MM-DD]
 * Normally this happens automatically after every import; use this after changing rules.
 */
import { prisma } from "@/lib/prisma";
import { forTenant } from "@/server/db/tenant";
import { measureOutcomes, refreshFindings } from "@/server/findings/engine";

async function main() {
  const [tenantArg, asOf] = process.argv.slice(2);
  const tenants = tenantArg ? [{ id: tenantArg }] : await prisma.tenant.findMany({ select: { id: true } });
  for (const { id } of tenants) {
    const db = forTenant(id);
    const findings = await refreshFindings(db, id, asOf);
    const outcomes = await measureOutcomes(db, id, asOf);
    console.log(id, JSON.stringify({ findings, outcomes }));
  }
  await prisma.$disconnect();
}

void main();
