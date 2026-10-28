import { NextResponse, type NextRequest } from "next/server";
import { requireRequestRole } from "@/lib/auth";
import { queueWebsiteSync } from "@/server/adapters/website/queue";
import { purchaseInput, PurchaseError, recordPurchase } from "@/server/purchases/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Records a supplier's bill: stock goes up, costs are set, and the books are updated. */
export async function POST(request: NextRequest) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const parsed = purchaseInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Check the bill's details" }, { status: 400 });
  try {
    const bill = await recordPurchase(parsed.data, session.userId);
    await queueWebsiteSync("purchase recorded");
    return NextResponse.json({ billId: bill.id }, { status: 201 });
  } catch (error) {
    if (error instanceof PurchaseError) return NextResponse.json({ message: error.message }, { status: 409 });
    throw error;
  }
}
