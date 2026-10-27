import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, requireSignedIn, withActiveTenant } from "@/server/bi/api";
import { createBusiness } from "@/server/bi/business";
import { LIMITS, tooManyRequests } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().trim().min(2).max(120),
  domainPack: z.string().default("stationery")
});

/** Creates a real (non-demo) business with the caller as owner and a template-upload data source. */
export async function POST(request: NextRequest) {
  const owner = await requireSignedIn(request);
  if (owner instanceof NextResponse) return owner;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Business name must be 2-120 characters");
  const limited = LIMITS.businessesPerUser.take(owner.userId);
  if (!limited.ok) return tooManyRequests(limited.retryAfterSec, "Too many businesses created; try again later");
  try {
    const tenant = await prisma.$transaction((tx) => createBusiness(tx, owner.userId, parsed.data.name, parsed.data.domainPack));
    return withActiveTenant(NextResponse.json({ tenantId: tenant.id }, { status: 201 }), tenant.id);
  } catch (error) {
    return jsonError(400, "INVALID_INPUT", (error as Error).message);
  }
}
