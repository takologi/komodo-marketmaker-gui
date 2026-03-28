import "server-only";

import { readFile, rename } from "node:fs/promises";

import { logDebugEvent } from "@/lib/debug/logger";
import { getKcbHttpTimeoutMs } from "@/lib/kcb/env";
import { kcbPaths } from "@/lib/kcb/paths";
import { readJsonFile, writeJsonFile, ensureKcbLayout } from "@/lib/kcb/storage";
import { CoinCacheMeta, CoinSourceConfig } from "@/lib/kcb/types";
import { JsonValue } from "@/lib/kdf/types";

interface RefreshResult {
  cachedPath: string;
  metaPath: string;
  itemCount: number;
  fetchedAt: string;
  sourceUrl: string;
}

async function readCoinSources(): Promise<CoinSourceConfig> {
  await ensureKcbLayout();
  try {
    return await readJsonFile<CoinSourceConfig>(kcbPaths.coinSources());
  } catch (error) {
    const fallback: CoinSourceConfig = {
      coins_config_url: process.env.KCB_COINS_CONFIG_URL ||
        "https://raw.githubusercontent.com/KomodoPlatform/coins/master/coins",
      icons_base_url: process.env.KCB_ICONS_BASE_URL ||
        "https://raw.githubusercontent.com/KomodoPlatform/coins/master/icons",
    };

    const backup = `${kcbPaths.coinSources()}.corrupt.${Date.now()}`;
    try {
      await rename(kcbPaths.coinSources(), backup);
    } catch {
      // Best effort backup for corrupt content.
    }

    await writeJsonFile(kcbPaths.coinSources(), fallback);
    await logDebugEvent({
      severity: "warning",
      title: "KCB coin source config recovered",
      body: "coin-sources.json was missing/invalid; regenerated from environment defaults",
      details: {
        error: error instanceof Error ? error.message : String(error),
        backup,
        fallback,
      },
    });

    return fallback;
  }
}

export async function refreshCoinDefinitions(): Promise<RefreshResult> {
  const sources = await readCoinSources();
  const timeoutMs = getKcbHttpTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await logDebugEvent({
      severity: "info",
      title: "KCB coins refresh",
      body: "Fetching coins definitions from configured source",
      details: { url: sources.coins_config_url },
    });

    const response = await fetch(sources.coins_config_url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Coins source returned HTTP ${response.status}`);
    }

    const text = await response.text();

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text) as JsonValue;
    } catch {
      parsed = text;
    }

    await writeJsonFile(kcbPaths.coinsConfigCache(), parsed);

    const itemCount = Array.isArray(parsed)
      ? parsed.length
      : parsed && typeof parsed === "object"
        ? Object.keys(parsed as Record<string, JsonValue>).length
        : 1;

    const meta: CoinCacheMeta = {
      fetched_at: new Date().toISOString(),
      source_url: sources.coins_config_url,
      item_count: itemCount,
    };

    await writeJsonFile(kcbPaths.coinsMetaCache(), meta);

    await logDebugEvent({
      severity: "info",
      title: "KCB coins refresh completed",
      body: "Successfully refreshed coin definitions cache",
      details: {
        source: sources.coins_config_url,
        cachePath: kcbPaths.coinsConfigCache(),
        itemCount,
      },
    });

    return {
      cachedPath: kcbPaths.coinsConfigCache(),
      metaPath: kcbPaths.coinsMetaCache(),
      itemCount,
      fetchedAt: meta.fetched_at,
      sourceUrl: sources.coins_config_url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logDebugEvent({
      severity: "error",
      title: "KCB coins refresh failed",
      body: "Failed to refresh coin definitions from configured source",
      details: {
        source: sources.coins_config_url,
        message,
      },
    });
    throw new Error(`Coin definitions refresh failed (${sources.coins_config_url}): ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function getCoinDefinitions(): Promise<JsonValue> {
  await ensureKcbLayout();

  try {
    const raw = await readFile(kcbPaths.coinsConfigCache(), "utf8");
    return JSON.parse(raw) as JsonValue;
  } catch (error) {
    await logDebugEvent({
      severity: "warning",
      title: "KCB coins cache miss",
      body: "Coins cache missing; fetching from source on first use",
      details: { cachePath: kcbPaths.coinsConfigCache() },
    });

    try {
      await refreshCoinDefinitions();
      const raw = await readFile(kcbPaths.coinsConfigCache(), "utf8");
      return JSON.parse(raw) as JsonValue;
    } catch (refreshError) {
      const baseMessage = error instanceof Error ? error.message : String(error);
      const refreshMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
      throw new Error(
        `Coin definitions cache unavailable and refresh failed. cache_error=${baseMessage}; refresh_error=${refreshMessage}`,
      );
    }
  }
}
