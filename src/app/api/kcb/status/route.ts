import { NextResponse } from "next/server";

import { getKcbDashboardStatus } from "@/lib/kcb/queries";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await getKcbDashboardStatus();
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load KCB status";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
