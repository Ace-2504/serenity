import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireRequestRole } from "@/lib/auth";
import { queueWebsiteSync } from "@/server/adapters/website/queue";
import { deletePurchase, markPaid, PurchaseError } from "@/server/purchases/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const patch = z.object({ paidOn: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]) });

/** Marks a bill paid (or unpaid). */
export async function PATCH(request: NextRequest, { params }: { params: { billId: string } }) {
  const session = requireRequestRole(request, ["owner_admin"]);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const parsed = patch.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: "paidOn must be a date or null" }, { status: 400 });
  try {
    await markPaid(params.billId, parsed.data.paidOn);
  } catch (error) {
    if (error instanceof PurchaseError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
  await queueWebsiteSync("purchase paid");
  return NextResponse.json({ ok: true });
}

/** Removes a bill entered by mistake, taking its stock back out. */
export async function DELETE(request: NextRequest, { params }: { params: { billId: string } }) {
  const session = requireRequestRole(request, ["owner_admin"]);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try {
    await deletePurchase(params.billId);
  } catch (error) {
    if (error instanceof PurchaseError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
  await queueWebsiteSync("purchase removed");
  return NextResponse.json({ ok: true });
}
