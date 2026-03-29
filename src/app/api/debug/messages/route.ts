import { NextRequest, NextResponse } from "next/server";

import { consumePopupNotifications } from "@/lib/debug/popup-bus";

function getPopupTimeoutSeconds(): number {
  const raw = process.env.DEBUG_MESSAGE_TIMEOUT;
  const parsed = raw ? Number.parseInt(raw, 10) : 8;
  if (!Number.isFinite(parsed) || parsed < 0) return 8;
  return parsed;
}

export async function GET(request: NextRequest) {
  const rawLimit = request.nextUrl.searchParams.get("limit");
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
  const data = consumePopupNotifications(limit);

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    timeoutSeconds: getPopupTimeoutSeconds(),
    data,
  });
}
