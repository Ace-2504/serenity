import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { clientIp, LIMITS, takeForIp, tooManyRequests } from "@/server/security/rate-limit";

export async function POST(request: NextRequest) {
  const isForm = (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded");
  const body = isForm ? await request.formData() : await request.json();

  const email = String(body.get?.("email") ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.get?.("password") ?? body.password ?? "");

  const limited = [LIMITS.loginPerEmail.take(email), takeForIp(LIMITS.loginPerIp, clientIp(request))].find((r) => !r.ok);
  if (limited && !limited.ok) {
    if (isForm) return NextResponse.redirect(new URL("/admin/login?error=rate_limited", request.url), 303);
    return tooManyRequests(limited.retryAfterSec, "Too many sign-in attempts; wait a few minutes");
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { userRoles: { include: { role: true } }, _count: { select: { memberships: true } } }
  });

  const roles = user?.userRoles.map((item) => item.role.code) ?? [];
  // Shop staff, or someone a business has made a member (e.g. its accountant).
  const adminRole = roles.some((role) => role !== "customer") || (user?._count.memberships ?? 0) > 0;

  if (!user || !adminRole || !verifyPassword(password, user.passwordHash)) {
    if (isForm) {
      return NextResponse.redirect(new URL("/admin/login?error=invalid", request.url), 303);
    }

    return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
  }

  const token = createSessionToken({
    userId: user.id,
    email: user.email,
    roles
  });

  if (isForm) {
    const response = NextResponse.redirect(new URL(roles.some((r) => r !== "customer") ? "/admin" : "/admin/erp", request.url), 303);
    setSessionCookie(response, token);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, token);
  return response;
}