import { NextResponse } from "next/server";
import { databaseHealth } from "@/server/ops/status";

export const dynamic = "force-dynamic";

/** Liveness and database reachability, for Docker and uptime checks. 503 when the database is down. */
export async function GET() {
  const db = await databaseHealth();
  return NextResponse.json(
    { ok: db.ok, service: "paper-serenity-stationery-hub", database: db, timestamp: new Date().toISOString() },
    { status: db.ok ? 200 : 503 }
  );
}
