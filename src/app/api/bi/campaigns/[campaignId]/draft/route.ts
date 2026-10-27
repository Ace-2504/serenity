import { NextResponse, type NextRequest } from "next/server";
import { LlmConfigError, LlmUnavailableError, OpenAICompatibleModel } from "@/server/assistant/llm";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { suggestDraft, templateDraft } from "@/server/campaigns/draft";
import { validateOffer, type Offer } from "@/server/campaigns/workflow";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Suggests wording for a campaign. Returns text only; nothing is saved or sent. The editor may pass
 * the offer it is showing ({ offerPct }), so the wording matches an offer not yet saved.
 */
export async function POST(request: NextRequest, { params }: { params: { campaignId: string } }) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const limited = LIMITS.draftsPerUser.take(bi.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many suggestions; wait a minute");
  const c = await bi.db.campaign.findFirst({ where: { id: params.campaignId } });
  if (!c) return jsonError(404, "NOT_FOUND", "Campaign not found");
  const body = (await request.json().catch(() => ({}))) as { offerPct?: unknown };
  let offer = c.offer as Offer;
  if (body.offerPct === null) offer = null;
  else if (typeof body.offerPct === "number") {
    offer = { kind: "percent_off", value: body.offerPct };
    const problems = validateOffer(offer);
    if (problems.length) return jsonError(400, "INVALID_OFFER", problems.join("; "));
  }
  try {
    return NextResponse.json(await suggestDraft(new OpenAICompatibleModel(), bi.tenant.name, c.goal, offer));
  } catch (error) {
    if (!(error instanceof LlmUnavailableError || error instanceof LlmConfigError)) throw error;
    return NextResponse.json({ ...templateDraft(bi.tenant.name, c.goal, offer), note: `${error.message}; this is a template.` });
  }
}
