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
import { fetchFromCoinpaprika } from "@/lib/kcb/prices/sources/coinpaprika";
import { waitForSourceThrottleWindow } from "@/lib/kcb/prices/throttling";

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
      coinpaprikaId: parseCoinMetadataId(def, "coinpaprika_id", "coinpaprikaId"),
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
  if (type === "coinpaprika") return fetchFromCoinpaprika;
  return null;
}

export interface ReferencePriceFetchDetails {
  quoteTicker: string;
  mergedByPair: Record<string, number>;
  byTickerBySource: Record<string, Record<string, number>>;
}

export async function fetchReferencePriceDetailsFromConfiguredSources(params: {
  tickers: string[];
  coinDefs: JsonValue;
}): Promise<ReferencePriceFetchDetails> {
  const coinSources = await getCoinSourcesConfig();
  const cfg = coinSources.price_sources;
  const quoteTicker = (cfg?.quote_ticker || "USDT").toUpperCase();

  if (!cfg || cfg.enabled === false) {
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
    };
  }

  const configuredSources = (cfg.sources || []).filter((source) => normalizeSourceEnabled(source));
  if (configuredSources.length === 0) {
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
    };
  }

  const allAssets = buildAssets(params.tickers, params.coinDefs);
  if (allAssets.length === 0) {
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
    };
  }

  await logDebugEvent({
    severity: "info",
    title: "KCB reference price fetch started",
    body: `Fetching reference prices for ${allAssets.length} ticker(s) from ${configuredSources.length} source(s)`,
    details: {
      tickers: allAssets.map((a) => a.ticker),
      sources: configuredSources.map((s) => ({ id: s.id, type: s.type, url: s.url })),
    },
  });

  const mergedByTicker: Record<string, number> = {};
  const byTickerBySource: Record<string, Record<string, number>> = {};

  for (const source of configuredSources) {
    const fetcher = getSourceFetcher(source.type);
    if (!fetcher) {
      await logDebugEvent({
        severity: "warning",
        title: "KCB reference price source unknown type",
        body: `Skipping unknown source type=${source.type}`,
        details: { sourceId: source.id },
      });
      continue;
    }

    await waitForSourceThrottleWindow(source.id);

    try {
      const result = await fetcher(source, {
        assets: allAssets,
        timeoutMs: normalizeTimeout(source),
      });

      for (const [tickerRaw, price] of Object.entries(result.pricesByTicker)) {
        const ticker = tickerRaw.toUpperCase();
        if (!Number.isFinite(price) || price <= 0) continue;

        if (!byTickerBySource[ticker]) {
          byTickerBySource[ticker] = {};
        }
        byTickerBySource[ticker][source.id] = price;

        if (!(ticker in mergedByTicker)) {
          mergedByTicker[ticker] = price;
        }
      }

      await logDebugEvent({
        severity: "info",
        title: "KCB reference price source completed",
        body: `Source ${source.id} returned ${Object.keys(result.pricesByTicker).length} price(s)`,
        details: {
          sourceId: source.id,
          sourceType: source.type,
          diagnostics: result.diagnostics,
        },
      });
    } catch (error) {
      await logDebugEvent({
        severity: "warning",
        title: "KCB reference price source failed",
        body: `Source ${source.id} failed while fetching reference prices`,
        details: {
          sourceId: source.id,
          sourceType: source.type,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const mergedByPair: Record<string, number> = {};
  for (const [ticker, price] of Object.entries(mergedByTicker)) {
    mergedByPair[`${ticker}/${quoteTicker}`] = price;
  }

  await logDebugEvent({
    severity: "info",
    title: "KCB reference price fetch finished",
    body: `Resolved ${Object.keys(mergedByPair).length} normalized reference pair(s)`,
    details: {
      quoteTicker,
      resolvedPairs: Object.keys(mergedByPair),
    },
  });

  return {
    quoteTicker,
    mergedByPair,
    byTickerBySource,
  };
}

export async function fetchReferencePricesFromConfiguredSources(params: {
  tickers: string[];
  coinDefs: JsonValue;
}): Promise<Record<string, number>> {
  const detailed = await fetchReferencePriceDetailsFromConfiguredSources(params);
  return detailed.mergedByPair;
}
