import { NextResponse } from "next/server";

import { adaptOrders } from "@/lib/kdf/adapters/orders";
import { fetchOrdersRaw } from "@/lib/kdf/client";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const raw = await fetchOrdersRaw();
    const data = adaptOrders(raw);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load orders";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
