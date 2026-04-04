import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const isForm = (request.headers.get("content-type") || "").includes("application/x-www-form-urlencoded");
  const body = isForm ? await request.formData() : await request.json();

  const get = (key: string) => String(body.get?.(key) ?? (body as Record<string, unknown>)[key] ?? "").trim();

  const firstName   = get("firstName");
  const lastName    = get("lastName");
  const email       = get("email").toLowerCase();
  const password    = get("password");
  const confirmPassword = get("confirmPassword");
  const label       = get("label");
  const line1       = get("line1");
  const line2       = get("line2");
  const city        = get("city");
  const state       = get("state");
  const postalCode  = get("postalCode");
  const country     = get("country");
  const phone       = get("phone");
  const nextPath    = get("next") || "/";

  function errorRedirect(code: string) {
    return NextResponse.redirect(
      new URL(`/register?error=${code}&next=${encodeURIComponent(nextPath)}`, request.url)
    );
  }

  // Validation
  if (!firstName || !email || !password || !label || !line1 || !city || !state || !postalCode || !country || !phone) {
    if (isForm) return errorRedirect("missing_fields");
    return NextResponse.json({ message: "Profile and address fields are required." }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (isForm) return errorRedirect("invalid_email");
    return NextResponse.json({ message: "Invalid email address." }, { status: 400 });
  }

  if (password.length < 8) {
    if (isForm) return errorRedirect("weak_password");
    return NextResponse.json({ message: "Password must be at least 8 characters." }, { status: 400 });
  }

  if (password !== confirmPassword) {
    if (isForm) return errorRedirect("password_mismatch");
    return NextResponse.json({ message: "Passwords do not match." }, { status: 400 });
  }

  // Check for duplicate email
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (isForm) return errorRedirect("email_taken");
    return NextResponse.json({ message: "An account with this email already exists." }, { status: 409 });
  }

  // Find customer role (create it if missing — e.g. on fresh DB without full seed)
  let customerRole = await prisma.role.findUnique({ where: { code: "customer" } });
  if (!customerRole) {
    customerRole = await prisma.role.create({ data: { code: "customer", name: "Customer" } });
  }

  const roleId = customerRole.id;

  // Create user, profile, and role assignment in one transaction
  const passwordHash = hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email,
        passwordHash,
        profile: {
          create: { firstName, lastName }
        },
        addresses: {
          create: {
            label,
            line1,
            line2: line2 || null,
            city,
            state,
            postalCode,
            country,
            phone,
            isDefault: true
          }
        },
        userRoles: {
          create: { roleId }
        }
      },
      include: { userRoles: { include: { role: true } } }
    });
    return newUser;
  });

  const roles = user.userRoles.map((entry) => entry.role.code);
  const token = createSessionToken({ userId: user.id, email: user.email, roles });

  if (isForm) {
    const response = NextResponse.redirect(new URL(nextPath, request.url));
    setSessionCookie(response, token);
    return response;
  }

  const response = NextResponse.json({ ok: true });
  setSessionCookie(response, token);
  return response;
}
