import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { withActiveTenant } from "@/server/bi/api";
import { createBusiness } from "@/server/bi/business";
import { clientIp, LIMITS, takeForIp } from "@/server/security/rate-limit";

export const dynamic = "force-dynamic";

/** Sign-up is open unless the operator closes it (SIGNUPS_OPEN=0), e.g. on a private office install. */
const signupsOpen = () => process.env.SIGNUPS_OPEN !== "0";

const form = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(10).max(200),
  // Empty when the visitor only wants to look at the demo first.
  businessName: z.union([z.literal(""), z.string().trim().min(2).max(120)]),
  trade: z.string().default("stationery"),
});

/**
 * Self-serve sign-up for Serenity BI: creates the account and, when a business name is given,
 * the business with the new user as its owner. A plain form post, so it works without scripts.
 */
export async function POST(request: NextRequest) {
  const data = await request.formData();
  const get = (key: string) => String(data.get(key) ?? "");
  const demo = get("demo") === "1";
  const back = (error: string) =>
    NextResponse.redirect(
      new URL(`/signup?error=${error}${demo ? "&demo=1" : ""}`, request.url),
      303,
    );

  if (!signupsOpen()) return back("closed");
  const limited = takeForIp(LIMITS.registerPerIp, clientIp(request));
  if (!limited.ok) return back("rate_limited");

  const parsed = form.safeParse({
    name: get("name"),
    email: get("email"),
    password: get("password"),
    businessName: get("businessName").trim(),
    trade: get("trade") || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return back(
      field === "password"
        ? "weak_password"
        : field === "email"
          ? "invalid_email"
          : field === "businessName"
            ? "business_name"
            : "missing_fields",
    );
  }
  const { name, email, password, businessName, trade } = parsed.data;
  if (!demo && !businessName) return back("business_name");
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } }))
    return back("email_taken");

  const [firstName, ...rest] = name.split(/\s+/);
  let created: { userId: string; tenantId: string | null };
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: hashPassword(password),
          profile: { create: { firstName, lastName: rest.join(" ") } },
        },
      });
      const tenant = businessName
        ? await createBusiness(tx, user.id, businessName, trade)
        : null;
      return { userId: user.id, tenantId: tenant?.id ?? null };
    });
  } catch (error) {
    // Two sign-ups racing for one email: the unique index decides.
    if ((error as { code?: string }).code === "P2002")
      return back("email_taken");
    if ((error as Error).message?.includes("Domain pack"))
      return back("missing_fields");
    throw error;
  }

  const target = created.tenantId ? "/bi/imports" : "/bi";
  let response = NextResponse.redirect(new URL(target, request.url), 303);
  setSessionCookie(
    response,
    createSessionToken({ userId: created.userId, email, roles: [] }),
  );
  if (created.tenantId) response = withActiveTenant(response, created.tenantId);
  return response;
}
