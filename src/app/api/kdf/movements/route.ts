import { NextResponse } from "next/server";

import { adaptMovements } from "@/lib/kdf/adapters/movements";
import { fetchMovementsRawWithAvailability } from "@/lib/kdf/client";
import { UiApiResponse } from "@/lib/kdf/types";

interface MovementApiData {
  rows: ReturnType<typeof adaptMovements>;
  integration: {
    available: boolean;
    method?: string;
    message?: string;
  };
}

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
    const raw = await fetchMovementsRawWithAvailability();
    const data: MovementApiData = {
      rows: adaptMovements(raw.rows),
      integration: {
        available: raw.available,
        method: raw.method,
        message: raw.message,
      },
    };
    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load movements";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
