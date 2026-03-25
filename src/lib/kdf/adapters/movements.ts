import { MovementViewRaw } from "@/lib/kdf/client";
import { asString } from "@/lib/kdf/adapters/common";

export interface MovementView {
  id: string;
  pair: string;
  side: string;
  status: string;
  startedAt: string;
}

export function adaptMovements(raw: MovementViewRaw[]): MovementView[] {
  return raw.map((row, index) => {
    const base = asString(row.maker_coin ?? row.base, "?");
    const rel = asString(row.taker_coin ?? row.rel, "?");

    return {
      id: asString(row.uuid ?? row.id, `movement-${index + 1}`),
      pair: `${base}/${rel}`,
      side: asString(row.type ?? row.side, "swap"),
      status: asString(row.status, "unknown"),
      startedAt: asString(row.started_at ?? row.timestamp, "unknown"),
    };
  });
}
