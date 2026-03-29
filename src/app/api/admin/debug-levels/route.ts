import { NextRequest, NextResponse } from "next/server";

import { logDebugEvent } from "@/lib/debug/logger";
import { getRuntimeDebugLevels, setRuntimeDebugLevels } from "@/lib/debug/runtime-levels";
import { DEBUG_SEVERITIES } from "@/lib/debug/severity";
import { isAuthorizedRestartToken } from "@/lib/system/restart";

interface DebugLevelsResponse {
  ok: boolean;
  message: string;
  data?: {
    messageLevel: string;
    logLevel: string;
    logWindowEnabled: boolean;
    allowed: readonly string[];
  };
}

function unauthorized(): NextResponse {
  const body: DebugLevelsResponse = {
    ok: false,
    message: "Unauthorized debug-level change request",
  };
  return NextResponse.json(body, { status: 401 });
}

export async function GET(request: NextRequest) {
  const headerToken = request.headers.get("x-admin-token");
  if (!isAuthorizedRestartToken(headerToken)) {
    return unauthorized();
  }

  const levels = getRuntimeDebugLevels();
  const body: DebugLevelsResponse = {
    ok: true,
    message: "Runtime debug levels retrieved",
    data: {
      ...levels,
      allowed: DEBUG_SEVERITIES,
    },
  };
  return NextResponse.json(body);
}

export async function POST(request: NextRequest) {
  const headerToken = request.headers.get("x-admin-token");
  if (!isAuthorizedRestartToken(headerToken)) {
    return unauthorized();
  }

  const json = (await request.json()) as {
    messageLevel?: string;
    logLevel?: string;
    logWindowEnabled?: boolean;
  };

  const updated = setRuntimeDebugLevels({
    messageLevel: json.messageLevel,
    logLevel: json.logLevel,
    logWindowEnabled: json.logWindowEnabled,
  });

  await logDebugEvent({
    severity: "info",
    title: "Runtime debug levels updated",
    body: "Admin changed runtime popup/log filtering levels",
    details: updated,
  });

  const body: DebugLevelsResponse = {
    ok: true,
    message: "Runtime debug levels updated",
    data: {
      ...updated,
      allowed: DEBUG_SEVERITIES,
    },
  };
  return NextResponse.json(body);
}
