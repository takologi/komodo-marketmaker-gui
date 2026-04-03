import { NextRequest, NextResponse } from "next/server";

import { buildAnnotatedOrderbook } from "@/lib/kcb/orders/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET(request: NextRequest) {
  const fetchedAt = new Date().toISOString();
  const { searchParams } = new URL(request.url);
  const base = searchParams.get("base")?.toUpperCase() ?? "";
  const rel = searchParams.get("rel")?.toUpperCase() ?? "";

  if (!base || !rel) {
    const body: UiApiResponse<never> = {
      ok: false,
      message: "Missing required query parameters: base and rel",
      fetchedAt,
    };
    return NextResponse.json(body, { status: 400 });
  }

  try {
    const data = await buildAnnotatedOrderbook(base, rel);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch orderbook";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
