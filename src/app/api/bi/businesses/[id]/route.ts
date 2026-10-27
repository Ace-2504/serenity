import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { jsonError, requireSignedIn } from "@/server/bi/api";
import { ACTIVE_TENANT_COOKIE } from "@/server/bi/context";

export const dynamic = "force-dynamic";

const body = z.object({ confirmName: z.string() });

/**
 * Permanently deletes a business and everything imported into it. Only its owner may, and only
 * after typing the business's name. Accounts of other members are kept; they lose access.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireSignedIn(request);
  if (user instanceof NextResponse) return user;
  const membership = user.memberships.find((m) => m.tenantId === params.id);
  if (!membership) return jsonError(404, "NOT_FOUND", "No such business");
  if (membership.role !== "owner_admin") return jsonError(403, "FORBIDDEN", "Only the business owner can delete it");
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || parsed.data.confirmName.trim() !== membership.name) {
    return jsonError(400, "CONFIRMATION_MISMATCH", "Type the business name exactly to confirm");
  }
  await prisma.tenant.delete({ where: { id: params.id } });
  const response = NextResponse.json({ deleted: params.id });
  response.cookies.delete(ACTIVE_TENANT_COOKIE);
  return response;
}
