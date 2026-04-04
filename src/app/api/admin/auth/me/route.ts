import { NextRequest, NextResponse } from "next/server";
import { requireRequestRole } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager", "order_operations"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    roles: session.roles
  });
}