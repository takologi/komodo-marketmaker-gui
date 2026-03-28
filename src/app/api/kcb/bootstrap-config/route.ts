import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedKcbWrite } from "@/lib/kcb/auth";
import { getBootstrapConfig, saveBootstrapConfig } from "@/lib/kcb/bootstrap/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await getBootstrapConfig();
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load bootstrap config";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return saveBootstrapConfigHandler(request);
}

export async function PUT(request: NextRequest) {
  return saveBootstrapConfigHandler(request);
}

async function saveBootstrapConfigHandler(request: NextRequest) {
  const fetchedAt = new Date().toISOString();
  if (!isAuthorizedKcbWrite(request)) {
    const body: UiApiResponse<never> = { ok: false, message: "Unauthorized", fetchedAt };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    const payload = await request.json();
    const data = await saveBootstrapConfig(payload);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save bootstrap config";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 400 });
  }
}
