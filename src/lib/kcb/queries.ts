import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { adaptOrders } from "@/lib/kdf/adapters/orders";
import { adaptStatus } from "@/lib/kdf/adapters/status";
import { WalletTxHistoryItem, WalletViewEnriched } from "@/lib/kdf/adapters/wallets";
import { adaptMovements } from "@/lib/kdf/adapters/movements";
import { asNumber, asString } from "@/lib/kdf/adapters/common";
import {
  fetchOrdersRaw,
  fetchSimpleMmStatusOptional,
  fetchVersionOptional,
  fetchCoinBalanceSafe,
  fetchMovementsRawWithAvailability,
  fetchTxHistoryRawOptional,
  StatusViewRaw,
  TxHistoryRaw,
} from "@/lib/kdf/client";
import { ensureKcbLayout } from "@/lib/kcb/storage";
import { getCoinDefinitions } from "@/lib/kcb/coins/provider";
import { getBootstrapConfig, getLastApplyState } from "@/lib/kcb/bootstrap/service";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

const REF_PRICE_ENDPOINTS = [
  "https://prices.gleec.com/api/v2/tickers",
  "https://prices.cipig.net:1717/api/v2/tickers",
  "https://defistats.gleec.com/api/v3/prices/tickers_v2",
];

interface PairStatus {
  pair: string;
  hasActiveOrders: boolean;
}

export interface KcbDashboardStatusView {
  connectionOk: boolean;
  connectionMessage: string;
  simpleMm: {
    available: boolean;
    status?: ReturnType<typeof adaptStatus>;
    message?: string;
    orderHint?: string;
  };
  refreshRateMs: number;
  configuredPairs: string[];
  activeOrderCount: number;
  pairsWithActiveOrders: number;
  activeOrderUuids: string[];
  pairStatuses: PairStatus[];
  referencePricesByPair: Record<string, number>;
  version: {
    available: boolean;
    value: string;
    sourceMethod: string;
    message?: string;
  };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePairReferencePrices(raw: StatusViewRaw | undefined): Record<string, number> {
  const output: Record<string, number> = {};
  if (!raw || !Array.isArray(raw.pairs)) return output;

  for (const item of raw.pairs) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as StatusViewRaw;
    const pair = asString(row.pair, "").toUpperCase();
    if (!pair.includes("/")) continue;

    const candidates = [
      row.price,
      row.last_price,
      row.reference_price,
      row.oracle_price,
      row.best_ask,
      row.best_bid,
    ];
    const price = candidates
      .map((v) => asNumber(v, Number.NaN))
      .find((n) => Number.isFinite(n) && n >= 0);
    if (price !== undefined && Number.isFinite(price) && price >= 0) {
      output[pair] = price;
    }
  }

  return output;
}

async function fetchReferencePricesByPairOptional(): Promise<Record<string, number>> {
  for (const endpoint of REF_PRICE_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        await logDebugEvent({
          severity: "warning",
          title: "KCB reference price endpoint error",
          body: `Reference price source returned HTTP ${response.status}`,
          details: { endpoint, status: response.status },
        });
        continue;
      }

      const json = (await response.json()) as JsonValue;
      if (!isJsonObject(json)) {
        await logDebugEvent({
          severity: "warning",
          title: "KCB reference price endpoint shape",
          body: "Reference price response is not an object",
          details: { endpoint },
        });
        continue;
      }

      const map: Record<string, number> = {};
      for (const [ticker, row] of Object.entries(json)) {
        const normalizedTicker = ticker.toUpperCase();
        if (!normalizedTicker) continue;

        let price = Number.NaN;
        if (isJsonObject(row)) {
          price = asNumber(row.last_price ?? row.price ?? row.last, Number.NaN);
        } else {
          price = asNumber(row, Number.NaN);
        }

        if (Number.isFinite(price) && price >= 0) {
          map[`${normalizedTicker}/USDT`] = price;
        }
      }

      await logDebugEvent({
        severity: "debug",
        title: "KCB reference prices refreshed",
        body: `Loaded ${Object.keys(map).length} reference prices`,
        details: {
          endpoint,
          ltc_usdt: map["LTC/USDT"] ?? null,
          btc_usdt: map["BTC/USDT"] ?? null,
        },
      });

      return map;
    } catch (error) {
      await logDebugEvent({
        severity: "warning",
        title: "KCB reference price endpoint failed",
        body: "Failed to fetch reference prices from endpoint",
        details: {
          endpoint,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  await logDebugEvent({
    severity: "warning",
    title: "KCB reference prices unavailable",
    body: "All configured reference price endpoints failed; reference prices are empty",
    details: { endpoints: REF_PRICE_ENDPOINTS },
  });

  return {};
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

function normalizeExplorerTemplate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed;
}

function pickTxExplorerTemplate(def: JsonObject | null): string | undefined {
  if (!def) return undefined;

  const directCandidates = [
    def.tx_explorer_url,
    def.explorer_tx_url,
    def.txurl,
    def.tx_url,
    def.transaction_url,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return normalizeExplorerTemplate(candidate);
    }
  }

  const explorers = def.explorers;
  if (Array.isArray(explorers)) {
    for (const entry of explorers) {
      if (typeof entry === "string" && entry.trim()) {
        return normalizeExplorerTemplate(entry);
      }
      if (isJsonObject(entry)) {
        const objectCandidates = [
          entry.tx,
          entry.tx_url,
          entry.txurl,
          entry.transaction,
          entry.transaction_url,
          entry.url,
          entry.explorer,
        ];
        for (const candidate of objectCandidates) {
          if (typeof candidate === "string" && candidate.trim()) {
            return normalizeExplorerTemplate(candidate);
          }
        }
      }
    }
  }

  const fallback = def.explorer_url ?? def.explorer;
  if (typeof fallback === "string" && fallback.trim()) {
    return normalizeExplorerTemplate(fallback);
  }

  return undefined;
}

function buildExplorerTxUrl(template: string | undefined, txid: string): string | undefined {
  if (!template || !txid) return undefined;

  if (template.includes("{txid}")) {
    return template.replaceAll("{txid}", txid);
  }

  if (template.includes("%s")) {
    return template.replace("%s", txid);
  }

  const normalized = template.endsWith("/") ? template : `${template}/`;
  return `${normalized}tx/${txid}`;
}

function pickString(...values: Array<JsonValue | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toWalletTxHistoryRows(rows: TxHistoryRaw[], explorerTemplate?: string): WalletTxHistoryItem[] {
  return rows
    .map((row) => {
      const txid = pickString(row.tx_hash, row.txid, row.hash, row.internal_id, row.id);
      if (!txid) return null;

      const amount = asNumber(
        row.my_balance_change ?? row.received_by_me ?? row.spent_by_me ?? row.amount,
        Number.NaN,
      );

      return {
        txid,
        timestamp: asNumber(row.timestamp ?? row.time, Number.NaN),
        amount: Number.isFinite(amount) ? amount : undefined,
        confirmations: asNumber(row.confirmations, Number.NaN),
        blockHeight: asNumber(row.block_height ?? row.height, Number.NaN),
        blockHash: pickString(row.block_hash),
        explorerUrl: buildExplorerTxUrl(explorerTemplate, txid),
      } as WalletTxHistoryItem;
    })
    .filter((row): row is WalletTxHistoryItem => Boolean(row))
    .map((row) => ({
      ...row,
      timestamp: Number.isFinite(row.timestamp ?? Number.NaN) ? row.timestamp : undefined,
      confirmations: Number.isFinite(row.confirmations ?? Number.NaN) ? row.confirmations : undefined,
      blockHeight: Number.isFinite(row.blockHeight ?? Number.NaN) ? row.blockHeight : undefined,
    }));
}

function parseConfiguredPairs(raw: StatusViewRaw, statusPair: string): string[] {
  const pairsFromArray = raw.configured_pairs;
  if (Array.isArray(pairsFromArray)) {
    const parsed = pairsFromArray
      .map((item) => (typeof item === "string" ? item : null))
      .filter((value): value is string => Boolean(value));
    if (parsed.length > 0) return parsed;
  }

  if (statusPair && statusPair !== "not configured") {
    return [statusPair];
  }

  return [];
}

function buildSimpleMmOrderHint(params: {
  available: boolean;
  status?: ReturnType<typeof adaptStatus>;
  activeOrderCount: number;
}): string | undefined {
  if (!params.available || !params.status) return undefined;

  const state = params.status.state.toLowerCase();
  const running = ["running", "active", "ok"].includes(state);
  const enabledPairCount = params.status.enabledPairs.length;
  if (running && enabledPairCount > 0 && params.activeOrderCount === 0) {
    return "Simple MM is running but no active orders were created yet (common causes: unavailable provider price, zero balance, or pair min-volume/min-price constraints).";
  }

  return undefined;
}

function emptyStatusRaw(): StatusViewRaw {
  return {
    state: "unavailable",
    status: "unavailable",
    strategy: "simple-mm",
    pair: "not configured",
    running_seconds: 0,
  };
}

export async function getKcbDashboardStatus(): Promise<KcbDashboardStatusView> {
  await ensureKcbLayout();
  const [rawStatusOptional, rawOrders, versionOptional, endpointReferencePrices] = await Promise.all([
    fetchSimpleMmStatusOptional(),
    fetchOrdersRaw(),
    fetchVersionOptional(),
    fetchReferencePricesByPairOptional(),
  ]);

  const simpleMmStatus = rawStatusOptional.available
    ? adaptStatus(rawStatusOptional.raw ?? emptyStatusRaw())
    : undefined;

  const orders = adaptOrders(rawOrders);
  const activeOrderUuids = orders.map((order) => order.id);
  const configuredPairs =
    simpleMmStatus && simpleMmStatus.configuredPairs.length > 0
      ? simpleMmStatus.configuredPairs
      : parseConfiguredPairs(
        rawStatusOptional.raw ?? emptyStatusRaw(),
        simpleMmStatus?.pair ?? "not configured",
      );

  const activePairsSet = new Set(orders.map((order) => `${order.base}/${order.rel}`.toUpperCase()));
  const normalizedConfiguredPairs = configuredPairs.map((pair) => pair.toUpperCase());

  const pairStatuses: PairStatus[] = normalizedConfiguredPairs.map((pair) => ({
    pair,
    hasActiveOrders: activePairsSet.has(pair),
  }));

  const orderHint = buildSimpleMmOrderHint({
    available: rawStatusOptional.available,
    status: simpleMmStatus,
    activeOrderCount: orders.length,
  });

  const statusReferencePrices = parsePairReferencePrices(rawStatusOptional.raw);
  const mergedReferencePrices = {
    ...statusReferencePrices,
    ...endpointReferencePrices,
  };

  return {
    connectionOk: true,
    connectionMessage: "KCB connected to KDF RPC adapter",
    simpleMm: {
      available: rawStatusOptional.available,
      status: simpleMmStatus,
      message: rawStatusOptional.message,
      orderHint,
    },
    refreshRateMs: Number.parseInt(process.env.NEXT_PUBLIC_POLL_MS ?? "5000", 10) || 5000,
    configuredPairs: normalizedConfiguredPairs,
    activeOrderCount: orders.length,
    pairsWithActiveOrders: pairStatuses.filter((pair) => pair.hasActiveOrders).length,
    activeOrderUuids,
    pairStatuses,
    referencePricesByPair: mergedReferencePrices,
    version: {
      available: versionOptional.available,
      value: versionOptional.available ? String(versionOptional.result ?? "available") : "not available",
      sourceMethod: versionOptional.method ?? "none",
      message: versionOptional.message,
    },
  };
}

export async function getKcbOrders() {
  await ensureKcbLayout();
  const raw = await fetchOrdersRaw();
  return adaptOrders(raw);
}

export async function getKcbWallets(): Promise<WalletViewEnriched[]> {
  await ensureKcbLayout();
  const [cfg, lastApply, coinDefs] = await Promise.all([
    getBootstrapConfig(),
    getLastApplyState(),
    getCoinDefinitions(),
  ]);

  // Build coin → activation error map from last-apply error strings.
  // Expected format: "activation failed for BTC: <reason>"
  const coinErrorMap = new Map<string, string>();
  for (const msg of lastApply.errors) {
    const match = /^activation failed for ([^:]+):\s*(.+)$/i.exec(msg);
    if (match) {
      coinErrorMap.set(match[1].toUpperCase().trim(), match[2].trim());
    }
  }

  const results = await Promise.all(
    cfg.coins.map(async (coinCfg): Promise<WalletViewEnriched> => {
      const ticker = coinCfg.coin.toUpperCase();
      const raw = await fetchCoinBalanceSafe(ticker);
      if (raw) {
        const balance = asNumber(raw.balance);
        const unspendable = asNumber(raw.unspendable_balance, 0);
        const explicitSpendable = asNumber(raw.spendable_balance ?? raw.available, Number.NaN);
        const spendable = Number.isNaN(explicitSpendable)
          ? Math.max(0, balance - unspendable)
          : Math.max(0, explicitSpendable);
        const requiredConfirmations = asNumber(raw.required_confirmations, Number.NaN);

        const coinDef = pickCoinDefinitionByTicker(coinDefs, ticker);
        const explorerTemplate = pickTxExplorerTemplate(coinDef);
        const txHistoryRaw = await fetchTxHistoryRawOptional(ticker, 20);

        return {
          coin: asString(raw.ticker ?? raw.coin, ticker),
          activated: true,
          address: asString(raw.address, undefined),
          balance,
          spendable,
          unspendable,
          requiredConfirmations: Number.isFinite(requiredConfirmations)
            ? requiredConfirmations
            : undefined,
          txHistory: {
            available: txHistoryRaw.available,
            message: txHistoryRaw.message,
            rows: toWalletTxHistoryRows(txHistoryRaw.rows, explorerTemplate),
          },
        };
      }
      return {
        coin: ticker,
        activated: false,
        error: coinErrorMap.get(ticker) ?? "Coin is not activated",
      };
    }),
  );

  return results;
}

export async function getKcbMovements() {
  await ensureKcbLayout();
  const raw = await fetchMovementsRawWithAvailability();
  return {
    rows: adaptMovements(raw.rows),
    integration: {
      available: raw.available,
      method: raw.method,
      message: raw.message,
    },
  };
}
