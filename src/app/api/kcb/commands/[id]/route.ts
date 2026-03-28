import { NextResponse } from "next/server";

import { getKcbCommandById } from "@/lib/kcb/commands/service";
import { UiApiResponse } from "@/lib/kdf/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const fetchedAt = new Date().toISOString();
  try {
    const { id } = await context.params;
    const data = await getKcbCommandById(id);
    if (!data) {
      const body: UiApiResponse<never> = { ok: false, message: "Command not found", fetchedAt };
      return NextResponse.json(body, { status: 404 });
    }

    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load command";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
