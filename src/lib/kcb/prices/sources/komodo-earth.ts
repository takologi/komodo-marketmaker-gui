import { PriceSourceFetcher, isJsonObject, parsePositiveNumber } from "@/lib/kcb/prices/types";
import { detectAndHandlePotentialThrottling } from "@/lib/kcb/prices/throttling";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

function pickPriceFromRow(row: JsonValue | undefined): number | undefined {
  if (typeof row === "number" || typeof row === "string") {
    return parsePositiveNumber(row);
  }

  if (!isJsonObject(row)) return undefined;

  const candidates = [
    row.last_price,
    row.price,
    row.usd,
    row.rate,
    row.close,
  ];

  for (const value of candidates) {
    const parsed = parsePositiveNumber(value);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function buildCaseInsensitiveMap(root: JsonObject): Map<string, JsonValue> {
  const output = new Map<string, JsonValue>();
  for (const [key, value] of Object.entries(root)) {
    output.set(key.toUpperCase(), value);
  }
  return output;
}

export const fetchFromKomodoEarth: PriceSourceFetcher = async (source, ctx) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

  try {
    const response = await fetch(source.url, {
      cache: "no-store",
      signal: controller.signal,
    });

    await detectAndHandlePotentialThrottling({
      sourceId: source.id,
      status: response.status,
      headers: response.headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = (await response.json()) as JsonValue;
    if (!isJsonObject(json)) {
      throw new Error("Expected object payload");
    }

    const byKey = buildCaseInsensitiveMap(json);
    const pricesByTicker: Record<string, number> = {};

    for (const asset of ctx.assets) {
      const row = byKey.get(asset.ticker.toUpperCase());
      const price = pickPriceFromRow(row);
      if (price !== undefined) {
        pricesByTicker[asset.ticker.toUpperCase()] = price;
      }
    }

    return {
      pricesByTicker,
      diagnostics: {
        source: source.id,
        type: source.type,
        matchedTickers: Object.keys(pricesByTicker).length,
      },
    };
  } finally {
    clearTimeout(timer);
  }
};
