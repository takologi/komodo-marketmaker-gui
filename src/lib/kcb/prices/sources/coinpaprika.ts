import { PriceSourceFetcher, isJsonObject, parsePositiveNumber } from "@/lib/kcb/prices/types";
import { detectAndHandlePotentialThrottling } from "@/lib/kcb/prices/throttling";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

function buildTickersUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(`${normalizedBase}/tickers`);
  url.searchParams.set("quotes", "USD");
  return url.toString();
}

function extractUsdPrice(payload: JsonValue): number | undefined {
  if (!isJsonObject(payload)) return undefined;

  const quotes = payload.quotes;
  if (!isJsonObject(quotes)) return undefined;

  const usd = (quotes as JsonObject).USD;
  if (!isJsonObject(usd)) return undefined;

  return parsePositiveNumber((usd as JsonObject).price);
}

export const fetchFromCoinpaprika: PriceSourceFetcher = async (source, ctx) => {
  const assets = ctx.assets.filter((asset) => Boolean(asset.coinpaprikaId && asset.coinpaprikaId.trim()));
  if (assets.length === 0) {
    return {
      pricesByTicker: {},
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "no_assets_with_coinpaprika_id",
        requestedAssets: 0,
        requestedIds: 0,
        matchedTickers: 0,
      },
    };
  }

  const idToTicker = new Map<string, string>();
  for (const asset of assets) {
    const id = asset.coinpaprikaId?.trim().toLowerCase();
    if (!id) continue;
    idToTicker.set(id, asset.ticker.toUpperCase());
  }

  const pricesByTicker: Record<string, number> = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

  try {
    const response = await fetch(buildTickersUrl(source.url), {
      cache: "no-store",
      signal: controller.signal,
    });

    await detectAndHandlePotentialThrottling({
      sourceId: source.id,
      status: response.status,
      headers: response.headers,
    });

    if (!response.ok) {
      const bodyPreview = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${bodyPreview ? `: ${bodyPreview.slice(0, 160)}` : ""}`);
    }

    const payload = (await response.json()) as JsonValue;
    if (!Array.isArray(payload)) {
      throw new Error("Expected array payload");
    }

    for (const row of payload) {
      if (!isJsonObject(row)) continue;
      const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
      if (!id) continue;

      const ticker = idToTicker.get(id);
      if (!ticker) continue;

      const usdPrice = extractUsdPrice(row);
      if (usdPrice !== undefined) {
        pricesByTicker[ticker] = usdPrice;
      }
    }

    return {
      pricesByTicker,
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "ok",
        requestedAssets: assets.length,
        requestedIds: idToTicker.size,
        matchedTickers: Object.keys(pricesByTicker).length,
      },
    };
  } finally {
    clearTimeout(timer);
  }
};
