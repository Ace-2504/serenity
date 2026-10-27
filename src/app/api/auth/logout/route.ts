import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { safeNextPath } from "@/server/security/rate-limit";

export async function POST(request: NextRequest) {
  const isForm = (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded");
  const body = isForm ? await request.formData() : null;
  const nextPath = safeNextPath(String(body?.get("next") ?? "/"));

  if (isForm) {
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    clearSessionCookie(response);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}