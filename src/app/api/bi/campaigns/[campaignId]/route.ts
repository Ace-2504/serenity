import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audienceSchema } from "@/server/campaigns/schemas";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { updateCampaign } from "@/server/campaigns/service";
import { WorkflowError } from "@/server/campaigns/workflow";

export const dynamic = "force-dynamic";

const body = z.object({
  audience: audienceSchema.optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
  offer: z.object({ kind: z.literal("percent_off"), value: z.number(), note: z.string().max(200).optional() }).nullable().optional()
});

/** Edit a draft. Editing an approved part withdraws its approval and every later one. */
export async function PATCH(request: NextRequest, { params }: { params: { campaignId: string } }) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (!(await bi.db.campaign.findFirst({ where: { id: params.campaignId }, select: { id: true } }))) return jsonError(404, "NOT_FOUND", "Campaign not found");
  try {
    const c = await updateCampaign(bi.db, bi.tenant.id, bi.userId, params.campaignId, parsed.data);
    return NextResponse.json({ id: c.id, status: c.status });
  } catch (error) {
    if (error instanceof WorkflowError) return jsonError(409, "INVALID_TRANSITION", error.message);
    throw error;
  }
}
