import { NextResponse, type NextRequest } from "next/server";
import type { MembershipRole } from "@prisma/client";
import { ACTIVE_TENANT_COOKIE, getBiContextFromRequest, type BiContext } from "@/server/bi/context";
import { ImportError } from "@/server/ingest/pipeline";

type Resolved = Awaited<ReturnType<typeof getBiContextFromRequest>>;

export const jsonError = (status: number, code: string, message: string, details?: unknown) => NextResponse.json({ code, message, details }, { status });

/** Resolves the caller's business and checks their role; returns a response to send instead on failure. */
export async function requireBi(request: NextRequest, roles?: MembershipRole[]): Promise<BiContext | NextResponse> {
  const resolved = await getBiContextFromRequest(request);
  if (!resolved) return jsonError(401, "UNAUTHENTICATED", "Sign in first");
  if (!resolved.context) return jsonError(404, "NO_BUSINESS", "You are not a member of any business yet");
  if (roles && !roles.includes(resolved.context.role)) return jsonError(403, "FORBIDDEN", `Your role (${resolved.context.role}) cannot do this`);
  return resolved.context;
}

/** For actions that create businesses: needs a signed-in platform owner, not a membership. */
export async function requirePlatformOwner(request: NextRequest): Promise<NonNullable<Resolved> | NextResponse> {
  const resolved = await getBiContextFromRequest(request);
  if (!resolved) return jsonError(401, "UNAUTHENTICATED", "Sign in first");
  if (!resolved.sessionRoles.includes("owner_admin")) return jsonError(403, "FORBIDDEN", "Only the platform owner can create businesses");
  return resolved;
}

export function withActiveTenant(response: NextResponse, tenantId: string): NextResponse {
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}

const IMPORT_ERROR_STATUS: Record<ImportError["code"], number> = {
  NOT_FOUND: 404,
  NOT_COMMITTABLE: 409,
  FILES_CHANGED: 409,
  VALIDATION_FAILED: 422,
  RECONCILIATION_FAILED: 422
};

export function importErrorResponse(error: unknown): NextResponse {
  if (error instanceof ImportError) return jsonError(IMPORT_ERROR_STATUS[error.code], error.code, error.message, error.details);
  console.error(error);
  return jsonError(500, "INTERNAL", "The import failed unexpectedly; nothing was written. Try again or contact support.");
}
