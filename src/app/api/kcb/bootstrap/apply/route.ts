import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedKcbWrite } from "@/lib/kcb/auth";
import { enqueueKcbCommand } from "@/lib/kcb/commands/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function POST(request: NextRequest) {
  const fetchedAt = new Date().toISOString();
  if (!isAuthorizedKcbWrite(request)) {
    const body: UiApiResponse<never> = { ok: false, message: "Unauthorized", fetchedAt };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    const data = await enqueueKcbCommand({
      type: "apply_bootstrap",
      priority: "normal",
    });

    const body: UiApiResponse<typeof data> = {
      ok: true,
      data,
      fetchedAt,
      message: "Bootstrap apply command queued",
    };
    return NextResponse.json(body, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to queue bootstrap apply";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
