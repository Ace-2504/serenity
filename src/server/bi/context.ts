import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { getServerSession, getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { forTenant, type TenantDb } from "@/server/db/tenant";

export const ACTIVE_TENANT_COOKIE = "bi_tenant";

export type BiContext = {
  userId: string;
  /** Storefront roles from the session (only owner_admin may create businesses). */
  sessionRoles: string[];
  tenant: { id: string; name: string; isDemo: boolean; domainPack: string };
  role: MembershipRole;
  memberships: { tenantId: string; name: string; isDemo: boolean; role: MembershipRole }[];
  db: TenantDb;
};

/** Who may do what inside a business. */
export const CAN_IMPORT: MembershipRole[] = ["owner_admin", "accountant"];

/**
 * Resolves the signed-in user's active business. Membership lookup is the one cross-tenant
 * query in the platform: it is keyed by the session's user id, and everything after it goes
 * through forTenant(). Returns null when there is no session, and { tenant: null } when the
 * user belongs to no business yet.
 */
async function resolve(session: { userId: string; roles: string[] } | null, preferredTenantId: string | undefined) {
  if (!session) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: session.userId },
    include: { tenant: { select: { id: true, name: true, isDemo: true, domainPack: true } } },
    orderBy: { createdAt: "asc" }
  });
  const active = memberships.find((m) => m.tenantId === preferredTenantId) ?? memberships.find((m) => !m.tenant.isDemo) ?? memberships[0];
  const base = {
    userId: session.userId,
    sessionRoles: session.roles,
    memberships: memberships.map((m) => ({ tenantId: m.tenantId, name: m.tenant.name, isDemo: m.tenant.isDemo, role: m.role }))
  };
  if (!active) return { ...base, context: null };
  const context: BiContext = { ...base, tenant: active.tenant, role: active.role, db: forTenant(active.tenantId) };
  return { ...base, context };
}

export async function getBiContext() {
  const preferred = cookies().get(ACTIVE_TENANT_COOKIE)?.value;
  return resolve(getServerSession(), preferred);
}

export async function getBiContextFromRequest(request: NextRequest) {
  const preferred = request.cookies.get(ACTIVE_TENANT_COOKIE)?.value;
  return resolve(getSessionFromRequest(request), preferred);
}

