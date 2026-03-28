import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedKcbWrite } from "@/lib/kcb/auth";
import { enqueueKcbCommand, listKcbCommands } from "@/lib/kcb/commands/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await listKcbCommands();
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list commands";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const fetchedAt = new Date().toISOString();
  if (!isAuthorizedKcbWrite(request)) {
    const body: UiApiResponse<never> = { ok: false, message: "Unauthorized", fetchedAt };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      type: "restart_kdf" | "apply_bootstrap" | "refresh_coins";
      priority?: "high" | "normal";
    };

    const data = await enqueueKcbCommand(payload);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to enqueue command";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 400 });
  }
}
