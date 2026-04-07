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
import { fetchFromLiveCoinWatch } from "@/lib/kcb/prices/sources/livecoinwatch";
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
      livecoinwatchId: parseCoinMetadataId(def, "livecoinwatch_id", "livecoinwatchId"),
    });
  }

  return output;
}

function normalizeTimeout(source: PriceSourceConfigItem): number {
  const configured = typeof source.timeout_ms === "number" ? source.timeout_ms : Number.NaN;
  if (Number.isFinite(configured) && configured > 0) return configured;
  return getKcbHttpTimeoutMs();
}

function normalizeRefreshIntervalMs(source: PriceSourceConfigItem): number {
  const configured =
    typeof source.refresh_interval_ms === "number" ? source.refresh_interval_ms : Number.NaN;
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1000, Math.floor(configured));
  }
  return 30_000;
}

function normalizeSourceEnabled(source: PriceSourceConfigItem): boolean {
  return source.enabled !== false;
}

function getSourceFetcher(type: PriceSourceConfigItem["type"]): PriceSourceFetcher | null {
  if (type === "komodo_earth") return fetchFromKomodoEarth;
  if (type === "coingecko") return fetchFromCoingecko;
  if (type === "coinpaprika") return fetchFromCoinpaprika;
  if (type === "livecoinwatch") return fetchFromLiveCoinWatch;
  return null;
}

export interface ReferencePriceFetchDetails {
  quoteTicker: string;
  mergedByPair: Record<string, number>;
  byTickerBySource: Record<string, Record<string, number>>;
}

export interface CachedReferencePriceDetails {
  quoteTicker: string;
  mergedByPair: Record<string, number> | null;
  byTickerBySource: Record<string, Record<string, number>> | null;
  byTickerFetchedAtBySource: Record<string, Record<string, string>> | null;
  mergedMetaByPair: Record<string, { sourceId: string; fetchedAt: string }> | null;
}

interface SourceRefreshState {
  inFlight: boolean;
  nextRunAt: number;
  periodMs: number;
}

const runtimeState = {
  initialized: false,
  quoteTicker: "USDT",
  knownAssetsByTicker: new Map<string, PriceAsset>(),
  sourcePricesByTicker: {} as Record<string, Record<string, number>>,
  sourceFetchedAtByTicker: {} as Record<string, Record<string, string>>,
  byTickerBySource: {} as Record<string, Record<string, number>>,
  byTickerFetchedAtBySource: {} as Record<string, Record<string, string>>,
  mergedByPair: {} as Record<string, number>,
  mergedMetaByPair: {} as Record<string, { sourceId: string; fetchedAt: string }>,
  sourceRuntime: new Map<string, SourceRefreshState>(),
};

function upsertKnownAssets(assets: PriceAsset[]) {
  for (const asset of assets) {
    const key = asset.ticker.toUpperCase();
    const existing = runtimeState.knownAssetsByTicker.get(key);
    if (!existing) {
      runtimeState.knownAssetsByTicker.set(key, asset);
      continue;
    }

    runtimeState.knownAssetsByTicker.set(key, {
      ticker: key,
      coingeckoId: asset.coingeckoId || existing.coingeckoId,
      coinpaprikaId: asset.coinpaprikaId || existing.coinpaprikaId,
    });
  }
}

function rebuildMergedCache(configuredSources: PriceSourceConfigItem[], quoteTicker: string) {
  const byTickerBySource: Record<string, Record<string, number>> = {};
  const byTickerFetchedAtBySource: Record<string, Record<string, string>> = {};
  const mergedByTicker: Record<string, number> = {};
  const mergedMetaByTicker: Record<string, { sourceId: string; fetchedAt: string }> = {};

  for (const source of configuredSources) {
    const sourceRows = runtimeState.sourcePricesByTicker[source.id] || {};
    const sourceFetchedAtRows = runtimeState.sourceFetchedAtByTicker[source.id] || {};
    for (const [tickerRaw, price] of Object.entries(sourceRows)) {
      const ticker = tickerRaw.toUpperCase();
      if (!Number.isFinite(price) || price <= 0) continue;

      if (!byTickerBySource[ticker]) {
        byTickerBySource[ticker] = {};
      }
      byTickerBySource[ticker][source.id] = price;

      const fetchedAt = sourceFetchedAtRows[ticker];
      if (fetchedAt) {
        if (!byTickerFetchedAtBySource[ticker]) {
          byTickerFetchedAtBySource[ticker] = {};
        }
        byTickerFetchedAtBySource[ticker][source.id] = fetchedAt;
      }

      if (!(ticker in mergedByTicker)) {
        mergedByTicker[ticker] = price;
        mergedMetaByTicker[ticker] = {
          sourceId: source.id,
          fetchedAt: fetchedAt ?? new Date(0).toISOString(),
        };
      }
    }
  }

  const mergedByPair: Record<string, number> = {};
  const mergedMetaByPair: Record<string, { sourceId: string; fetchedAt: string }> = {};
  for (const [ticker, price] of Object.entries(mergedByTicker)) {
    const pair = `${ticker}/${quoteTicker}`;
    mergedByPair[pair] = price;
    if (mergedMetaByTicker[ticker]) {
      mergedMetaByPair[pair] = mergedMetaByTicker[ticker];
    }
  }

  runtimeState.quoteTicker = quoteTicker;
  runtimeState.byTickerBySource = byTickerBySource;
  runtimeState.byTickerFetchedAtBySource = byTickerFetchedAtBySource;
  runtimeState.mergedByPair = mergedByPair;
  runtimeState.mergedMetaByPair = mergedMetaByPair;
}

function pruneRemovedSources(configuredSources: PriceSourceConfigItem[]) {
  const sourceIds = new Set(configuredSources.map((source) => source.id));

  for (const sourceId of Object.keys(runtimeState.sourcePricesByTicker)) {
    if (!sourceIds.has(sourceId)) {
      delete runtimeState.sourcePricesByTicker[sourceId];
      delete runtimeState.sourceFetchedAtByTicker[sourceId];
    }
  }

  for (const sourceId of Array.from(runtimeState.sourceRuntime.keys())) {
    if (!sourceIds.has(sourceId)) {
      runtimeState.sourceRuntime.delete(sourceId);
    }
  }
}

function scheduleDueSourceRefreshes(configuredSources: PriceSourceConfigItem[]) {
  const assetsSnapshot = Array.from(runtimeState.knownAssetsByTicker.values());
  if (assetsSnapshot.length === 0) return;

  const now = Date.now();

  for (const source of configuredSources) {
    const fetcher = getSourceFetcher(source.type);
    if (!fetcher) {
      continue;
    }

    const periodMs = normalizeRefreshIntervalMs(source);
    const state = runtimeState.sourceRuntime.get(source.id) || {
      inFlight: false,
      nextRunAt: 0,
      periodMs,
    };
    state.periodMs = periodMs;
    runtimeState.sourceRuntime.set(source.id, state);

    if (state.inFlight || now < state.nextRunAt) {
      continue;
    }

    state.inFlight = true;
    state.nextRunAt = now + periodMs;

    void (async () => {
      await waitForSourceThrottleWindow(source.id);

      try {
        const result = await fetcher(source, {
          assets: assetsSnapshot,
          timeoutMs: normalizeTimeout(source),
        });

        const normalized: Record<string, number> = {};
        const fetchedAtByTicker: Record<string, string> = {};
        const fetchedAtIso = new Date().toISOString();
        for (const [tickerRaw, price] of Object.entries(result.pricesByTicker)) {
          const ticker = tickerRaw.toUpperCase();
          if (!Number.isFinite(price) || price <= 0) continue;
          normalized[ticker] = price;
          fetchedAtByTicker[ticker] = fetchedAtIso;
        }

        runtimeState.sourcePricesByTicker[source.id] = normalized;
        runtimeState.sourceFetchedAtByTicker[source.id] = fetchedAtByTicker;
        await logDebugEvent({
          severity: "info",
          title: "KCB reference price source completed",
          body: `Source ${source.id} returned ${Object.keys(normalized).length} price(s)`,
          details: {
            sourceId: source.id,
            sourceType: source.type,
            refreshIntervalMs: state.periodMs,
            diagnostics: result.diagnostics,
          },
        });
      } catch (error) {
        await logDebugEvent({
          severity: "warning",
          title: "KCB reference price source failed",
          body: `Source ${source.id} failed while refreshing reference prices`,
          details: {
            sourceId: source.id,
            sourceType: source.type,
            refreshIntervalMs: state.periodMs,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        state.inFlight = false;
        runtimeState.initialized = true;
        rebuildMergedCache(configuredSources, runtimeState.quoteTicker);
      }
    })();
  }
}

export async function getCachedReferencePriceDetailsFromConfiguredSources(params: {
  tickers: string[];
  coinDefs: JsonValue;
}): Promise<CachedReferencePriceDetails> {
  const coinSources = await getCoinSourcesConfig();
  const cfg = coinSources.price_sources;
  const quoteTicker = (cfg?.quote_ticker || "USDT").toUpperCase();
  runtimeState.quoteTicker = quoteTicker;

  if (!cfg || cfg.enabled === false) {
    runtimeState.initialized = true;
    runtimeState.byTickerBySource = {};
    runtimeState.byTickerFetchedAtBySource = {};
    runtimeState.mergedByPair = {};
    runtimeState.mergedMetaByPair = {};
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
      byTickerFetchedAtBySource: {},
      mergedMetaByPair: {},
    };
  }

  const configuredSources = (cfg.sources || []).filter((source) => normalizeSourceEnabled(source));
  if (configuredSources.length === 0) {
    runtimeState.initialized = true;
    runtimeState.byTickerBySource = {};
    runtimeState.byTickerFetchedAtBySource = {};
    runtimeState.mergedByPair = {};
    runtimeState.mergedMetaByPair = {};
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
      byTickerFetchedAtBySource: {},
      mergedMetaByPair: {},
    };
  }

  pruneRemovedSources(configuredSources);

  const assets = buildAssets(params.tickers, params.coinDefs);
  upsertKnownAssets(assets);

  rebuildMergedCache(configuredSources, quoteTicker);
  scheduleDueSourceRefreshes(configuredSources);

  if (!runtimeState.initialized) {
    return {
      quoteTicker,
      mergedByPair: null,
      byTickerBySource: null,
      byTickerFetchedAtBySource: null,
      mergedMetaByPair: null,
    };
  }

  return {
    quoteTicker,
    mergedByPair: { ...runtimeState.mergedByPair },
    byTickerBySource: Object.fromEntries(
      Object.entries(runtimeState.byTickerBySource).map(([ticker, bySource]) => [ticker, { ...bySource }]),
    ),
    byTickerFetchedAtBySource: Object.fromEntries(
      Object.entries(runtimeState.byTickerFetchedAtBySource).map(([ticker, bySource]) => [ticker, { ...bySource }]),
    ),
    mergedMetaByPair: Object.fromEntries(
      Object.entries(runtimeState.mergedMetaByPair).map(([pair, meta]) => [pair, { ...meta }]),
    ),
  };
}

export function getTickerPriceFetchTimestamp(params: {
  ticker: string;
  sourceId: string;
}): string | null {
  const ticker = params.ticker.toUpperCase().trim();
  if (!ticker) return null;
  const sourceRows = runtimeState.sourceFetchedAtByTicker[params.sourceId];
  if (!sourceRows) return null;
  return sourceRows[ticker] ?? null;
}

export async function forceRefreshReferencePriceForTicker(params: {
  ticker: string;
  coinDefs: JsonValue;
}): Promise<CachedReferencePriceDetails> {
  const normalizedTicker = params.ticker.toUpperCase().trim();
  if (!normalizedTicker) {
    return getCachedReferencePriceDetailsFromConfiguredSources({
      tickers: [],
      coinDefs: params.coinDefs,
    });
  }

  const coinSources = await getCoinSourcesConfig();
  const cfg = coinSources.price_sources;
  const quoteTicker = (cfg?.quote_ticker || "USDT").toUpperCase();

  if (!cfg || cfg.enabled === false) {
    runtimeState.initialized = true;
    runtimeState.quoteTicker = quoteTicker;
    return {
      quoteTicker,
      mergedByPair: {},
      byTickerBySource: {},
      byTickerFetchedAtBySource: {},
      mergedMetaByPair: {},
    };
  }

  const configuredSources = (cfg.sources || []).filter((source) => normalizeSourceEnabled(source));
  const assets = buildAssets([normalizedTicker], params.coinDefs);
  upsertKnownAssets(assets);
  const targetAssets = assets.length > 0 ? assets : [{ ticker: normalizedTicker }];

  for (const source of configuredSources) {
    const fetcher = getSourceFetcher(source.type);
    if (!fetcher) continue;

    await waitForSourceThrottleWindow(source.id);

    try {
      const result = await fetcher(source, {
        assets: targetAssets,
        timeoutMs: normalizeTimeout(source),
      });

      const currentPrices = {
        ...(runtimeState.sourcePricesByTicker[source.id] || {}),
      };
      const currentFetchedAt = {
        ...(runtimeState.sourceFetchedAtByTicker[source.id] || {}),
      };

      const fetchedAtIso = new Date().toISOString();
      const refreshedPrice = result.pricesByTicker[normalizedTicker];
      if (Number.isFinite(refreshedPrice) && refreshedPrice > 0) {
        currentPrices[normalizedTicker] = refreshedPrice;
        currentFetchedAt[normalizedTicker] = fetchedAtIso;
      } else {
        delete currentPrices[normalizedTicker];
        delete currentFetchedAt[normalizedTicker];
      }

      runtimeState.sourcePricesByTicker[source.id] = currentPrices;
      runtimeState.sourceFetchedAtByTicker[source.id] = currentFetchedAt;
    } catch {
      // best effort force refresh; keep previous cached values on failures
    }
  }

  runtimeState.initialized = true;
  rebuildMergedCache(configuredSources, quoteTicker);

  return getCachedReferencePriceDetailsFromConfiguredSources({
    tickers: [normalizedTicker],
    coinDefs: params.coinDefs,
  });
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
