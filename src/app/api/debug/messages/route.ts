import { NextRequest, NextResponse } from "next/server";

import { consumeClientMessages } from "@/lib/debug/popup-bus";

export async function GET(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  const data = consumeClientMessages(limit);

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    data,
  });
}
