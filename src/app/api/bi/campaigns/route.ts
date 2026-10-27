import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, requireBi } from "@/server/bi/api";
import { CAN_IMPORT } from "@/server/bi/context";
import { audienceSchema } from "@/server/campaigns/schemas";
import { createCampaign } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

const body = z.object({ name: z.string().trim().min(3).max(120), goal: z.string().trim().min(3).max(500), audience: audienceSchema, holdoutPct: z.number().int().min(0).max(50).optional() });

/** Draft a campaign. Drafting sends nothing; every later step needs the owner's approval. */
export async function POST(request: NextRequest) {
  const bi = await requireBi(request, CAN_IMPORT);
  if (bi instanceof NextResponse) return bi;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const campaign = await createCampaign(bi.db, bi.tenant.id, bi.userId, parsed.data);
  return NextResponse.json({ id: campaign.id }, { status: 201 });
}
