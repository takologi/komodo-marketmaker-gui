import { NextResponse } from "next/server";

import { adaptWallets } from "@/lib/kdf/adapters/wallets";
import { fetchWalletsRaw } from "@/lib/kdf/client";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const raw = await fetchWalletsRaw();
    const data = adaptWallets(raw);
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load wallets";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
