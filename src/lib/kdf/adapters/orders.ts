import { OrderViewRaw } from "@/lib/kdf/client";
import { asNumber, asString, asObject } from "@/lib/kdf/adapters/common";

export interface OrderView {
  id: string;
  base: string;
  rel: string;
  price: number;
  volume: number;
  side: string;
  createdAt: string;
}

export function adaptOrders(raw: OrderViewRaw[]): OrderView[] {
  return raw.map((row, index) => {
    const base = asString(row.base);
    const rel = asString(row.rel);
    const conf = asObject(row.conf_settings);

    return {
      id: asString(row.uuid ?? row.id, `order-${index + 1}`),
      base,
      rel,
      price: asNumber(row.price),
      volume: asNumber(row.max_base_vol ?? row.volume),
      side: asString(row.order_type ?? conf?.side, "maker"),
      createdAt: asString(row.created_at ?? row.timestamp, "unknown"),
    };
  });
}
