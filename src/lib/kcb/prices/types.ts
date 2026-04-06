import { JsonObject, JsonValue } from "@/lib/kdf/types";
import { PriceSourceConfigItem } from "@/lib/kcb/types";

export interface PriceAsset {
  ticker: string;
  coingeckoId?: string;
}

export interface PriceSourceContext {
  assets: PriceAsset[];
  timeoutMs: number;
}

export interface PriceSourceResult {
  pricesByTicker: Record<string, number>;
  diagnostics?: JsonObject;
}

export type PriceSourceFetcher = (
  source: PriceSourceConfigItem,
  ctx: PriceSourceContext,
) => Promise<PriceSourceResult>;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parsePositiveNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}
