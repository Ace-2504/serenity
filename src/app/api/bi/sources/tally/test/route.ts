import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { TallyClient, TallyConnectionError } from "@/server/adapters/tally/live";
import { TallyXmlError } from "@/server/adapters/tally/collect";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({ url: z.string().trim().min(8).max(200) });

/** Checks that Tally answers at the address and lists the companies open in it. Reads no vouchers. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const limited = LIMITS.tallyTestsPerUser.take(bi.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec);
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Give Tally's address, e.g. http://192.168.1.20:9000");
  try {
    const companies = await new TallyClient({ url: parsed.data.url, company: "" }, { timeoutMs: 10_000 }).companies();
    return NextResponse.json({ companies });
  } catch (error) {
    if (error instanceof TallyConnectionError || error instanceof TallyXmlError) return jsonError(502, "TALLY_UNREACHABLE", error.message);
    throw error;
  }
}
