import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "paper-serenity-stationery-hub",
    timestamp: new Date().toISOString()
  });
}