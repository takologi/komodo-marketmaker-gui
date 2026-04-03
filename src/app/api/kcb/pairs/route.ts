import { NextResponse } from "next/server";

import { getResolvedPairs } from "@/lib/kcb/pairs/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await getResolvedPairs();
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve trading pairs";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
