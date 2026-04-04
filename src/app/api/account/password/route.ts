import { NextRequest, NextResponse } from "next/server";
import { requireRequestAuth } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const session = requireRequestAuth(request);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const confirmPassword = String(body.confirmPassword ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ message: "All password fields are required." }, { status: 400 });
  }

  if (newPassword.length < 8) {
    return NextResponse.json({ message: "New password must be at least 8 characters." }, { status: 400 });
  }

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ message: "New password and confirmation do not match." }, { status: 400 });
  }

  if (currentPassword === newPassword) {
    return NextResponse.json({ message: "New password must be different from your current password." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, passwordHash: true }
  });

  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return NextResponse.json({ message: "Current password is incorrect." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(newPassword) }
  });

  return NextResponse.json({ message: "Password updated successfully." });
}
