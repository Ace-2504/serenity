import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

export async function GET(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const items = await prisma.address.findMany({
    where: { userId: session.userId },
    orderBy: [{ isDefault: "desc" }, { id: "desc" }],
    select: {
      id: true,
      label: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      country: true,
      phone: true,
      isDefault: true
    }
  });

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const label = String(body.label ?? "").trim();
  const line1 = String(body.line1 ?? "").trim();
  const line2 = String(body.line2 ?? "").trim();
  const city = String(body.city ?? "").trim();
  const state = String(body.state ?? "").trim();
  const postalCode = String(body.postalCode ?? "").trim();
  const country = String(body.country ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  const isDefault = normalizeBoolean(body.isDefault);

  if (!label || !line1 || !city || !state || !postalCode || !country || !phone) {
    return NextResponse.json({ message: "All required address fields must be provided." }, { status: 400 });
  }

  const address = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.address.count({ where: { userId: session.userId } });
    const makeDefault = isDefault || existingCount === 0;

    if (makeDefault) {
      await tx.address.updateMany({
        where: { userId: session.userId, isDefault: true },
        data: { isDefault: false }
      });
    }

    return tx.address.create({
      data: {
        userId: session.userId,
        label,
        line1,
        line2: line2 || null,
        city,
        state,
        postalCode,
        country,
        phone,
        isDefault: makeDefault
      },
      select: {
        id: true,
        label: true,
        line1: true,
        line2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        phone: true,
        isDefault: true
      }
    });
  });

  return NextResponse.json({ item: address }, { status: 201 });
}