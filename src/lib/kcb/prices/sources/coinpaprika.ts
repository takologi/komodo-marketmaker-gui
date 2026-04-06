import { PriceSourceFetcher, isJsonObject, parsePositiveNumber } from "@/lib/kcb/prices/types";
import { detectAndHandlePotentialThrottling } from "@/lib/kcb/prices/throttling";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

function buildTickerUrl(baseUrl: string, coinpaprikaId: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/tickers/${encodeURIComponent(coinpaprikaId)}`;
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
  const pricesByTicker: Record<string, number> = {};

  for (const asset of assets) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

    try {
      const url = buildTickerUrl(source.url, asset.coinpaprikaId as string);
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });

      await detectAndHandlePotentialThrottling({
        sourceId: source.id,
        status: response.status,
        headers: response.headers,
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as JsonValue;
      const usdPrice = extractUsdPrice(payload);
      if (usdPrice !== undefined) {
        pricesByTicker[asset.ticker.toUpperCase()] = usdPrice;
      }
    } catch {
      // Keep partial results and continue with next asset.
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    pricesByTicker,
    diagnostics: {
      source: source.id,
      type: source.type,
      requestedAssets: assets.length,
      matchedTickers: Object.keys(pricesByTicker).length,
    },
  };
};
