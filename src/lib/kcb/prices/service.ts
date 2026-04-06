import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { getCoinSourcesConfig } from "@/lib/kcb/coins/provider";
import { getKcbHttpTimeoutMs } from "@/lib/kcb/env";
import { PriceSourceConfigItem } from "@/lib/kcb/types";
import { JsonObject, JsonValue } from "@/lib/kdf/types";
import { asString } from "@/lib/kdf/adapters/common";
import { PriceAsset, PriceSourceFetcher } from "@/lib/kcb/prices/types";
import { fetchFromKomodoEarth } from "@/lib/kcb/prices/sources/komodo-earth";
import { fetchFromCoingecko } from "@/lib/kcb/prices/sources/coingecko";

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickCoinDefinitionByTicker(coinDefs: JsonValue, ticker: string): JsonObject | null {
  const wanted = ticker.toUpperCase();
  if (Array.isArray(coinDefs)) {
    for (const item of coinDefs) {
      if (!isJsonObject(item)) continue;
      const coin = asString(item.coin ?? item.ticker ?? item.symbol, "").toUpperCase();
      if (coin === wanted) return item;
    }
    return null;
  }

  if (!isJsonObject(coinDefs)) return null;
  const direct = coinDefs[wanted];
  if (isJsonObject(direct)) return direct;

  for (const value of Object.values(coinDefs)) {
    if (!isJsonObject(value)) continue;
    const coin = asString(value.coin ?? value.ticker ?? value.symbol, "").toUpperCase();
    if (coin === wanted) return value;
  }
  return null;
}

function parseCoinMetadataId(def: JsonObject | null, ...keys: string[]): string | undefined {
  if (!def) return undefined;
  for (const key of keys) {
    const value = def[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function buildAssets(tickers: string[], coinDefs: JsonValue): PriceAsset[] {
  const output: PriceAsset[] = [];
  const seen = new Set<string>();

  for (const ticker of tickers) {
    const normalizedTicker = ticker.toUpperCase().trim();
    if (!normalizedTicker || seen.has(normalizedTicker)) continue;
    seen.add(normalizedTicker);

    const def = pickCoinDefinitionByTicker(coinDefs, normalizedTicker);
    output.push({
      ticker: normalizedTicker,
      coingeckoId: parseCoinMetadataId(def, "coingecko_id", "coingeckoId"),
    });
  }

  return output;
}

function normalizeTimeout(source: PriceSourceConfigItem): number {
  const configured = typeof source.timeout_ms === "number" ? source.timeout_ms : Number.NaN;
  if (Number.isFinite(configured) && configured > 0) return configured;
  return getKcbHttpTimeoutMs();
}

function normalizeSourceEnabled(source: PriceSourceConfigItem): boolean {
  return source.enabled !== false;
}

function getSourceFetcher(type: PriceSourceConfigItem["type"]): PriceSourceFetcher | null {
  if (type === "komodo_earth") return fetchFromKomodoEarth;
  if (type === "coingecko") return fetchFromCoingecko;
  return null;
}

export async function fetchReferencePricesFromConfiguredSources(params: {
  tickers: string[];
  coinDefs: JsonValue;
}): Promise<Record<string, number>> {
  const coinSources = await getCoinSourcesConfig();
  const cfg = coinSources.price_sources;

  if (!cfg || cfg.enabled === false) {
    return {};
  }

  const quoteTicker = (cfg.quote_ticker || "USDT").toUpperCase();
  const configuredSources = (cfg.sources || []).filter((source) => normalizeSourceEnabled(source));
  if (configuredSources.length === 0) {
    return {};
  }

  const allAssets = buildAssets(params.tickers, params.coinDefs);
  if (allAssets.length === 0) {
    return {};
  }

  const resolvedByTicker: Record<string, number> = {};
  const missing = new Set(allAssets.map((asset) => asset.ticker));

  for (const source of configuredSources) {
    if (missing.size === 0) break;

    const fetcher = getSourceFetcher(source.type);
    if (!fetcher) {
      await logDebugEvent({
        severity: "warning",
        title: "KCB price source unknown type",
        body: `Skipping unknown price source type=${source.type}`,
        details: { sourceId: source.id },
      });
      continue;
    }

    const assetsForSource = allAssets.filter((asset) => missing.has(asset.ticker));
    try {
      const result = await fetcher(source, {
        assets: assetsForSource,
        timeoutMs: normalizeTimeout(source),
      });

      for (const [ticker, price] of Object.entries(result.pricesByTicker)) {
        if (Number.isFinite(price) && price > 0) {
          resolvedByTicker[ticker.toUpperCase()] = price;
          missing.delete(ticker.toUpperCase());
        }
      }

      await logDebugEvent({
        severity: "debug",
        title: "KCB price source fetch completed",
        body: `Source ${source.id} returned ${Object.keys(result.pricesByTicker).length} price(s)`,
        details: {
          sourceId: source.id,
          sourceType: source.type,
          diagnostics: result.diagnostics,
          unresolvedAfterSource: missing.size,
        },
      });
    } catch (error) {
      await logDebugEvent({
        severity: "warning",
        title: "KCB price source fetch failed",
        body: `Source ${source.id} failed; trying next source if available`,
        details: {
          sourceId: source.id,
          sourceType: source.type,
          error: error instanceof Error ? error.message : String(error),
          unresolvedBeforeFailure: missing.size,
        },
      });
    }
  }

  const output: Record<string, number> = {};
  for (const [ticker, price] of Object.entries(resolvedByTicker)) {
    output[`${ticker}/${quoteTicker}`] = price;
  }

  return output;
}
