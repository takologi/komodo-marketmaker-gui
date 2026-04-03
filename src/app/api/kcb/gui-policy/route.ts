import { NextRequest, NextResponse } from "next/server";

import { isAuthorizedKcbWrite } from "@/lib/kcb/auth";
import { getGuiPolicy, savePairPolicies } from "@/lib/kcb/gui-policy/service";
import { GuiPairPolicy } from "@/lib/kcb/types";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const data = await getGuiPolicy();
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load gui-policy";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}

/**
 * PUT /api/kcb/gui-policy
 * Body: { trading_pairs: GuiPairPolicy[] }
 *
 * Merges the supplied pair preferences into gui-policy.json.
 * Other fields in gui-policy.json are preserved.
 * Requires x-admin-token header.
 */
export async function PUT(request: NextRequest) {
  const fetchedAt = new Date().toISOString();
  if (!isAuthorizedKcbWrite(request)) {
    const body: UiApiResponse<never> = { ok: false, message: "Unauthorized", fetchedAt };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { trading_pairs?: GuiPairPolicy[] };
    if (!Array.isArray(payload.trading_pairs)) {
      const body: UiApiResponse<never> = {
        ok: false,
        message: "Body must contain a trading_pairs array",
        fetchedAt,
      };
      return NextResponse.json(body, { status: 400 });
    }
    const data = await savePairPolicies(payload.trading_pairs);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save gui-policy";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 400 });
  }
}
