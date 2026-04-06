import { PriceSourceFetcher, isJsonObject, parsePositiveNumber } from "@/lib/kcb/prices/types";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

function appendCoingeckoQuery(baseUrl: string, ids: string[]): string {
  const url = new URL(baseUrl);
  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("vs_currencies", "usd");
  return url.toString();
}

export const fetchFromCoingecko: PriceSourceFetcher = async (source, ctx) => {
  const idByTicker = new Map<string, string>();
  for (const asset of ctx.assets) {
    if (asset.coingeckoId && asset.coingeckoId.trim()) {
      idByTicker.set(asset.ticker.toUpperCase(), asset.coingeckoId.trim());
    }
  }

  const uniqueIds = Array.from(new Set(idByTicker.values()));
  if (uniqueIds.length === 0) {
    return {
      pricesByTicker: {},
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "no_assets_with_coingecko_id",
        requestedIds: 0,
        matchedTickers: 0,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

  try {
    const url = appendCoingeckoQuery(source.url, uniqueIds);
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = (await response.json()) as JsonValue;
    if (!isJsonObject(json)) {
      throw new Error("Expected object payload");
    }

    const pricesByTicker: Record<string, number> = {};

    for (const [ticker, coingeckoId] of idByTicker.entries()) {
      const row = (json as JsonObject)[coingeckoId];
      if (!isJsonObject(row)) continue;

      const price = parsePositiveNumber(row.usd);
      if (price !== undefined) {
        pricesByTicker[ticker] = price;
      }
    }

    return {
      pricesByTicker,
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "ok",
        requestedIds: uniqueIds.length,
        matchedTickers: Object.keys(pricesByTicker).length,
      },
    };
  } finally {
    clearTimeout(timer);
  }
};
