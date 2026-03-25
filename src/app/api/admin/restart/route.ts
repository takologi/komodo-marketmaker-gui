import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedRestartToken, triggerRestart } from "@/lib/system/restart";

interface RestartResponse {
  ok: boolean;
  message: string;
  output?: string;
}

export async function POST(request: NextRequest) {
  const headerToken = request.headers.get("x-admin-token");
  if (!isAuthorizedRestartToken(headerToken)) {
    const body: RestartResponse = {
      ok: false,
      message: "Unauthorized restart request",
    };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    const output = await triggerRestart();
    const body: RestartResponse = {
      ok: true,
      message: "Restart command submitted successfully",
      output,
    };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Restart command failed";
    const body: RestartResponse = {
      ok: false,
      message,
    };
    return NextResponse.json(body, { status: 500 });
  }
}
