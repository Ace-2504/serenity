import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const SESSION_COOKIE = "stationery_session";

export type SessionRole = "owner_admin" | "catalog_manager" | "order_operations" | "customer";

type SessionPayload = {
  userId: string;
  email: string;
  roles: SessionRole[];
  iat: number;
};

function getSecret(): string {
  return process.env.AUTH_SECRET || "dev-auth-secret-change-me";
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

export function parseSessionToken(token?: string): SessionPayload | null {
  if (!token) {
    return null;
  }

  const [body, signature] = token.split(".");
  if (!body || !signature || sign(body) !== signature) {
    return null;
  }

  try {
    return JSON.parse(fromBase64Url(body)) as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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