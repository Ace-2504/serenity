import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const isForm = (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded");
  const body = isForm ? await request.formData() : await request.json();
  const email = String(body.get?.("email") ?? body.email ?? "").trim().toLowerCase();
  const password = String(body.get?.("password") ?? body.password ?? "");
  const nextPath = String(body.get?.("next") ?? body.next ?? "/");

  const user = await prisma.user.findUnique({
    where: { email },
    include: { userRoles: { include: { role: true } } }
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    if (isForm) {
      return NextResponse.redirect(new URL(`/login?error=invalid&next=${encodeURIComponent(nextPath)}`, request.url));
    }

    return NextResponse.json({ message: "Invalid credentials" }, { status: 401 });
  }

  const roles = user.userRoles.map((entry) => entry.role.code);
  const token = createSessionToken({
    userId: user.id,
    email: user.email,
    roles
  });

  if (isForm) {
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    setSessionCookie(response, token);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, token);
  return response;
}