import { NextRequest, NextResponse } from "next/server";

import { consumeLogWindowMessages } from "@/lib/debug/log-window-bus";
import { getRuntimeDebugLevels } from "@/lib/debug/runtime-levels";

export async function GET(request: NextRequest) {
  const runtime = getRuntimeDebugLevels();
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 250;

  if (!runtime.logWindowEnabled) {
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      enabled: false,
      level: runtime.messageLevel,
      data: [],
    });
  }

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    enabled: true,
    level: runtime.messageLevel,
    data: consumeLogWindowMessages(limit),
  });
}
