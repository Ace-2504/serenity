import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getBiContextFromRequest } from "@/server/bi/context";
import { jsonError, withActiveTenant } from "@/server/bi/api";

export const dynamic = "force-dynamic";

/** Switches the active business; only to one the caller is a member of. */
export async function POST(request: NextRequest) {
  const resolved = await getBiContextFromRequest(request);
  if (!resolved) return jsonError(401, "UNAUTHENTICATED", "Sign in first");
  const parsed = z.object({ tenantId: z.string().uuid() }).safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !resolved.memberships.some((m) => m.tenantId === parsed.data.tenantId)) {
    return jsonError(404, "NOT_FOUND", "Business not found");
  }
  return withActiveTenant(NextResponse.json({ ok: true }), parsed.data.tenantId);
}
