import { NextResponse, type NextRequest } from "next/server";
import { checkTallyUrl, TallyConnectionError } from "@/server/adapters/tally/live";
import { TALLY_SOURCE_NAME, tallySettingsSchema } from "@/server/adapters/tally/sync";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";

export const dynamic = "force-dynamic";

/** Saves the live Tally connection (address, company, options). Nothing is read from Tally here. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  if (bi.tenant.isDemo) return jsonError(409, "DEMO_BUSINESS", "Connect Tally to your own business, not the demo");
  const parsed = tallySettingsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Give Tally's address (e.g. http://192.168.1.20:9000) and the company name exactly as in Tally");
  try {
    checkTallyUrl(parsed.data.url);
  } catch (error) {
    if (error instanceof TallyConnectionError) return jsonError(400, "INVALID_INPUT", error.message);
    throw error;
  }
  const settings = { ...parsed.data, autoCommit: parsed.data.autoCommit || parsed.data.dailySync };
  const existing = await bi.db.dataSource.findFirst({ where: { kind: "tally_http" } });
  const source = existing
    ? await bi.db.dataSource.update({ where: { id: existing.id }, data: { settings } })
    : await bi.db.dataSource.create({ data: { tenantId: bi.tenant.id, kind: "tally_http", name: TALLY_SOURCE_NAME, settings } });
  return NextResponse.json({ dataSourceId: source.id, settings });
}
