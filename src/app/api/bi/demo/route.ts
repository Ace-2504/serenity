import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { importErrorResponse, jsonError, requirePlatformOwner, withActiveTenant } from "@/server/bi/api";
import { createDemoBusiness } from "@/server/bi/demo";

export const dynamic = "force-dynamic";
// The full two-year demo takes about two minutes to import.
export const maxDuration = 300;

const body = z.object({ size: z.enum(["quick", "full"]).default("quick") });

export async function POST(request: NextRequest) {
  const owner = await requirePlatformOwner(request);
  if (owner instanceof NextResponse) return owner;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "size must be quick or full");
  try {
    const demo = await createDemoBusiness(owner.userId, parsed.data.size);
    return withActiveTenant(NextResponse.json(demo), demo.tenantId);
  } catch (error) {
    return importErrorResponse(error);
  }
}
