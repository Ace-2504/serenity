import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSelectableDomainPack } from "@/domain/packs";
import { prisma } from "@/lib/prisma";
import { jsonError, requirePlatformOwner, withActiveTenant } from "@/server/bi/api";

export const dynamic = "force-dynamic";

const body = z.object({
  name: z.string().trim().min(2).max(120),
  domainPack: z.string().default("stationery")
});

/** Creates a real (non-demo) business with the caller as owner and a template-upload data source. */
export async function POST(request: NextRequest) {
  const owner = await requirePlatformOwner(request);
  if (owner instanceof NextResponse) return owner;
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError(400, "INVALID_INPUT", "Business name must be 2-120 characters");
  try {
    getSelectableDomainPack(parsed.data.domainPack);
  } catch (error) {
    return jsonError(400, "INVALID_INPUT", (error as Error).message);
  }
  const tenant = await prisma.tenant.create({
    data: {
      name: parsed.data.name,
      domainPack: parsed.data.domainPack,
      memberships: { create: { userId: owner.userId, role: "owner_admin" } },
      dataSources: { create: { kind: "csv_template", name: "Template upload" } }
    }
  });
  return withActiveTenant(NextResponse.json({ tenantId: tenant.id }, { status: 201 }), tenant.id);
}
