import { PriceSourceFetcher, isJsonObject, parsePositiveNumber } from "@/lib/kcb/prices/types";
import { detectAndHandlePotentialThrottling } from "@/lib/kcb/prices/throttling";
import { JsonValue } from "@/lib/kdf/types";

function buildMapUrl(baseUrl: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/coins/map`;
}

export const fetchFromLiveCoinWatch: PriceSourceFetcher = async (source, ctx) => {
  const apiKey = source.api_key?.trim();
  if (!apiKey) {
    return {
      pricesByTicker: {},
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "missing_api_key",
        requestedAssets: 0,
        requestedIds: 0,
        matchedTickers: 0,
      },
    };
  }

  const idToTicker = new Map<string, string>();
  for (const asset of ctx.assets) {
    const id = asset.livecoinwatchId?.trim().toUpperCase();
    if (!id) continue;
    idToTicker.set(id, asset.ticker.toUpperCase());
  }

  const codes = Array.from(new Set(idToTicker.keys()));
  if (codes.length === 0) {
    return {
      pricesByTicker: {},
      diagnostics: {
        source: source.id,
        type: source.type,
        reason: "no_assets_with_livecoinwatch_id",
        requestedAssets: 0,
        requestedIds: 0,
        matchedTickers: 0,
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);

  try {
    const response = await fetch(buildMapUrl(source.url), {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        currency: "USD",
        codes,
        meta: false,
      }),
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

    const pricesByTicker: Record<string, number> = {};
    for (const row of payload) {
      if (!isJsonObject(row)) continue;
      const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
      if (!code) continue;

      const ticker = idToTicker.get(code);
      if (!ticker) continue;

      const price = parsePositiveNumber(row.rate);
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
        requestedAssets: ctx.assets.length,
        requestedIds: codes.length,
        matchedTickers: Object.keys(pricesByTicker).length,
      },
    };
  } finally {
    clearTimeout(timer);
  }
};
