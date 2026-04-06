import "server-only";

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
  OrderViewRaw,
  StatusViewRaw,
  TxHistoryRaw,
} from "@/lib/kdf/client";
import { ensureKcbLayout } from "@/lib/kcb/storage";
import { getCoinDefinitions } from "@/lib/kcb/coins/provider";
import { getBootstrapConfig, getLastApplyState } from "@/lib/kcb/bootstrap/service";
import { getCachedReferencePriceDetailsFromConfiguredSources } from "@/lib/kcb/prices/service";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

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
  referencePricesByPair: Record<string, number> | null;
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

function normalizeBaseExplorerUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function buildTemplateFromExplorerBase(baseUrl: string, kind: "tx" | "address"): string {
  const base = normalizeBaseExplorerUrl(baseUrl);
  return `${base}/${kind}/{id}`;
}

function resolveExplorerTemplate(rawTemplate: string, baseUrl?: string): string {
  const template = normalizeExplorerTemplate(rawTemplate);
  if (!template) return "";
  if (/^https?:\/\//i.test(template)) return template;

  const base = typeof baseUrl === "string" && baseUrl.trim() ? normalizeBaseExplorerUrl(baseUrl) : "";
  if (!base) return template;

  if (template.startsWith("/")) return `${base}${template}`;
  return `${base}/${template}`;
}

function pickExplorerBaseUrl(def: JsonObject | null): string | undefined {
  if (!def) return undefined;
  const candidates = [def.explorer_url, def.explorer, def.block_explorer_url];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return normalizeBaseExplorerUrl(candidate);
  }
  return undefined;
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
  const baseExplorerUrl = pickExplorerBaseUrl(def);

  const directCandidates = [
    def.tx_explorer_url,
    def.explorer_tx_url,
    def.txurl,
    def.tx_url,
    def.transaction_url,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return resolveExplorerTemplate(candidate, baseExplorerUrl);
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
            return resolveExplorerTemplate(candidate, baseExplorerUrl);
          }
        }
      }
    }
  }

  if (baseExplorerUrl) {
    return buildTemplateFromExplorerBase(baseExplorerUrl, "tx");
  }

  return undefined;
}

function pickAddressExplorerTemplate(def: JsonObject | null): string | undefined {
  if (!def) return undefined;
  const baseExplorerUrl = pickExplorerBaseUrl(def);

  const directCandidates = [
    def.address_explorer_url,
    def.explorer_address_url,
    def.address_url,
    def.addr_url,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return resolveExplorerTemplate(candidate, baseExplorerUrl);
    }
  }

  if (baseExplorerUrl) {
    return buildTemplateFromExplorerBase(baseExplorerUrl, "address");
  }

  return undefined;
}

function buildExplorerTxUrl(template: string | undefined, txid: string): string | undefined {
  if (!template || !txid) return undefined;

  if (template.includes("{id}")) {
    return template.replaceAll("{id}", txid);
  }

  if (template.includes("{txid}")) {
    return template.replaceAll("{txid}", txid);
  }

  if (template.includes("%s")) {
    return template.replace("%s", txid);
  }

  if (/\/tx\/?$/i.test(template)) {
    const normalized = template.endsWith("/") ? template : `${template}/`;
    return `${normalized}${txid}`;
  }

  const normalized = template.endsWith("/") ? template : `${template}/`;
  return `${normalized}tx/${txid}`;
}

function buildExplorerAddressUrl(template: string | undefined, address: string): string | undefined {
  if (!template || !address) return undefined;

  if (template.includes("{id}")) {
    return template.replaceAll("{id}", address);
  }

  if (template.includes("{address}")) {
    return template.replaceAll("{address}", address);
  }

  if (template.includes("%s")) {
    return template.replace("%s", address);
  }

  if (/\/address\/?$/i.test(template)) {
    const normalized = template.endsWith("/") ? template : `${template}/`;
    return `${normalized}${address}`;
  }

  const normalized = template.endsWith("/") ? template : `${template}/`;
  return `${normalized}address/${address}`;
}

function pickString(...values: Array<JsonValue | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseStringArray(value: JsonValue | undefined): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }

    if (isJsonObject(item)) {
      const address = pickString(item.address, item.addr, item.value, item.account);
      if (address) out.push(address);
    }
  }

  return out;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function deriveDirection(amount: number | undefined, fromAddresses: string[], toAddresses: string[]) {
  if (Number.isFinite(amount ?? Number.NaN)) {
    if ((amount as number) > 0) return "received" as const;
    if ((amount as number) < 0) return "sent" as const;
    return "self" as const;
  }

  if (fromAddresses.length > 0 && toAddresses.length > 0) return "self" as const;
  if (toAddresses.length > 0) return "received" as const;
  if (fromAddresses.length > 0) return "sent" as const;
  return "unknown" as const;
}

function toWalletTxHistoryRows(
  rows: TxHistoryRaw[],
  txExplorerTemplate?: string,
  addressExplorerTemplate?: string,
): WalletTxHistoryItem[] {
  return rows
    .map((row) => {
      const txid = pickString(row.tx_hash, row.txid, row.hash, row.internal_id, row.id);
      if (!txid) return null;

      const fromAddresses = dedupeStrings(parseStringArray(row.from));
      const toAddresses = dedupeStrings(parseStringArray(row.to));

      const amount = asNumber(
        row.my_balance_change ?? row.received_by_me ?? row.spent_by_me ?? row.amount,
        Number.NaN,
      );
      const normalizedAmount = Number.isFinite(amount) ? amount : undefined;
      const direction = deriveDirection(normalizedAmount, fromAddresses, toAddresses);

      return {
        txid,
        timestamp: asNumber(row.timestamp ?? row.time, Number.NaN),
        amount: normalizedAmount,
        direction,
        fromAddresses,
        toAddresses,
        fromExplorerUrls: fromAddresses.map((address) => buildExplorerAddressUrl(addressExplorerTemplate, address) ?? ""),
        toExplorerUrls: toAddresses.map((address) => buildExplorerAddressUrl(addressExplorerTemplate, address) ?? ""),
        confirmations: asNumber(row.confirmations, Number.NaN),
        blockHeight: asNumber(row.block_height ?? row.height, Number.NaN),
        blockHash: pickString(row.block_hash),
        explorerUrl: buildExplorerTxUrl(txExplorerTemplate, txid),
      } as WalletTxHistoryItem;
    })
    .filter((row): row is WalletTxHistoryItem => Boolean(row))
    .map((row) => ({
      ...row,
      timestamp: Number.isFinite(row.timestamp ?? Number.NaN) ? row.timestamp : undefined,
      confirmations: Number.isFinite(row.confirmations ?? Number.NaN) ? row.confirmations : undefined,
      blockHeight: Number.isFinite(row.blockHeight ?? Number.NaN) ? row.blockHeight : undefined,
      fromExplorerUrls: row.fromExplorerUrls?.map((url) => url || undefined).filter((v): v is string => Boolean(v)),
      toExplorerUrls: row.toExplorerUrls?.map((url) => url || undefined).filter((v): v is string => Boolean(v)),
    }));
}

function parseOrderSide(raw: OrderViewRaw): "sell" | "buy" | "unknown" {
  const side = asString(raw.side ?? raw.order_type ?? raw.type, "").toLowerCase();
  if (side.includes("sell") || side.includes("ask")) return "sell";
  if (side.includes("buy") || side.includes("bid")) return "buy";

  const method = asString(raw.method, "").toLowerCase();
  if (method === "setprice") return "sell";

  return "unknown";
}

function parseOrderVolumeBase(raw: OrderViewRaw): number {
  const candidates = [
    raw.available_amount,
    raw.max_base_vol,
    raw.base_max_volume,
    raw.volume,
    raw.base_amount,
  ];

  for (const value of candidates) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return 0;
}

function parseOrderPrice(raw: OrderViewRaw): number {
  const candidates = [raw.price, raw.price_rat, raw.avg_price];
  for (const value of candidates) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function computeLockedByCoin(orders: OrderViewRaw[]): Map<string, number> {
  const locked = new Map<string, number>();

  for (const order of orders) {
    const base = asString(order.base, "").toUpperCase();
    const rel = asString(order.rel, "").toUpperCase();
    const baseVolume = parseOrderVolumeBase(order);
    const price = parseOrderPrice(order);
    const side = parseOrderSide(order);

    if (!base || !rel || baseVolume <= 0) continue;

    if (side === "sell" || side === "unknown") {
      locked.set(base, (locked.get(base) ?? 0) + baseVolume);
      continue;
    }

    const relAmount = price > 0 ? baseVolume * price : 0;
    if (relAmount > 0) {
      locked.set(rel, (locked.get(rel) ?? 0) + relAmount);
    }
  }

  return locked;
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
  const [rawStatusOptional, rawOrders, versionOptional, cfg, coinDefs] = await Promise.all([
    fetchSimpleMmStatusOptional(),
    fetchOrdersRaw(),
    fetchVersionOptional(),
    getBootstrapConfig(),
    getCoinDefinitions(),
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
  const wantedTickers = new Set<string>();
  for (const pair of normalizedConfiguredPairs) {
    const [base, rel] = pair.split("/");
    if (base) wantedTickers.add(base.toUpperCase());
    if (rel) wantedTickers.add(rel.toUpperCase());
  }
  for (const coin of cfg.coins) {
    if (coin.coin) wantedTickers.add(coin.coin.toUpperCase());
  }

  const externalReferenceDetails = await getCachedReferencePriceDetailsFromConfiguredSources({
    tickers: Array.from(wantedTickers),
    coinDefs,
  });

  const mergedReferencePrices = externalReferenceDetails.mergedByPair === null
    ? null
    : {
      ...statusReferencePrices,
      ...externalReferenceDetails.mergedByPair,
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
  const [cfg, lastApply, coinDefs, rawOrders] = await Promise.all([
    getBootstrapConfig(),
    getLastApplyState(),
    getCoinDefinitions(),
    fetchOrdersRaw(),
  ]);
  const lockedByCoin = computeLockedByCoin(rawOrders);
  const walletTickers = cfg.coins
    .map((coinCfg) => coinCfg.coin.toUpperCase())
    .filter((ticker, index, all) => Boolean(ticker) && all.indexOf(ticker) === index);

  const externalReferenceDetails = await getCachedReferencePriceDetailsFromConfiguredSources({
    tickers: walletTickers,
    coinDefs,
  });

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
        const spendableBeforeOrderLocks = Number.isNaN(explicitSpendable)
          ? Math.max(0, balance - unspendable)
          : Math.max(0, explicitSpendable);
        const lockedInOrders = lockedByCoin.get(ticker) ?? 0;
        const spendable = Math.max(0, spendableBeforeOrderLocks - lockedInOrders);
        const requiredConfirmations = asNumber(raw.required_confirmations, Number.NaN);

        const coinDef = pickCoinDefinitionByTicker(coinDefs, ticker);
        const txExplorerTemplate = pickTxExplorerTemplate(coinDef);
        const addressExplorerTemplate = pickAddressExplorerTemplate(coinDef);
        const txHistoryRaw = await fetchTxHistoryRawOptional(ticker, 20);

        return {
          coin: asString(raw.ticker ?? raw.coin, ticker),
          activated: true,
          address: asString(raw.address, undefined),
          balance,
          spendable,
          unspendable,
          referenceQuoteTicker: externalReferenceDetails.quoteTicker,
          referencePricesBySource: externalReferenceDetails.byTickerBySource?.[ticker] ?? null,
          requiredConfirmations: Number.isFinite(requiredConfirmations)
            ? requiredConfirmations
            : undefined,
          txHistory: {
            available: txHistoryRaw.available,
            message: txHistoryRaw.message,
            rows: toWalletTxHistoryRows(
              txHistoryRaw.rows,
              txExplorerTemplate,
              addressExplorerTemplate,
            ),
          },
        };
      }
      return {
        coin: ticker,
        activated: false,
        referenceQuoteTicker: externalReferenceDetails.quoteTicker,
        referencePricesBySource: externalReferenceDetails.byTickerBySource?.[ticker] ?? null,
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
