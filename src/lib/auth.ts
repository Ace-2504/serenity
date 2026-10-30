import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "stationery_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

const DEV_FALLBACK_SECRET = "dev-auth-secret-change-me";

export type SessionRole = "owner_admin" | "catalog_manager" | "order_operations" | "customer";

type SessionPayload = {
  userId: string;
  email: string;
  roles: SessionRole[];
  iat: number;
};

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production");
  }

  return DEV_FALLBACK_SECRET;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(data: string): string {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "iat">): string {
  const fullPayload: SessionPayload = {
    ...payload,
    iat: Date.now()
  };

  const body = base64Url(JSON.stringify(fullPayload));
  return `${body}.${sign(body)}`;
}

function signatureMatches(body: string, signature: string): boolean {
  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function parseSessionToken(token?: string, now: number = Date.now()): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature || !signatureMatches(body, signature)) {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromBase64Url(body)) as SessionPayload;
  } catch {
    return null;
  }

  // Tokens previously never expired; enforce the same lifetime as the cookie.
  const ageMs = now - payload.iat;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > SESSION_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  return payload;
}

/**
 * Whether cookies are marked Secure (sent over HTTPS only). On in production; COOKIE_SECURE=0 turns
 * it off for a plain-HTTP office network, where browsers would otherwise drop the session cookie.
 */
export const secureCookies = () => (process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE !== "0" : process.env.NODE_ENV === "production");

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 0
  });
}

export function getSessionFromRequest(request: NextRequest): SessionPayload | null {
  return parseSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
}

export function requireRequestRole(request: NextRequest, allowed: SessionRole[]): SessionPayload | null {
  const session = getSessionFromRequest(request);
  if (!session) {
    return null;
  }

  const hasRole = session.roles.some((role) => allowed.includes(role));
  return hasRole ? session : null;
}

export function requireRequestAuth(request: NextRequest): SessionPayload | null {
  return getSessionFromRequest(request);
}

export function getServerSession(): SessionPayload | null {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return parseSessionToken(token);
}

export async function requireServerRole(allowed: SessionRole[]): Promise<SessionPayload> {
  const session = getServerSession();
  if (!session || !session.roles.some((role) => allowed.includes(role))) {
    redirect("/admin/login");
  }

  return session;
}