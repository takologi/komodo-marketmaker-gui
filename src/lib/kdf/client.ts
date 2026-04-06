import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { DEFAULT_KDF_RPC_METHOD_SPEC, KDF_RPC_METHOD_SPECS } from "@/lib/kdf/rpc-methods";
import { JsonObject, JsonValue, KdfRpcEnvelope, KdfRpcError } from "@/lib/kdf/types";

const DEFAULT_TIMEOUT_MS = 15_000;
const unsupportedMethodsCache = new Set<string>();

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getTimeoutMs(): number {
  const raw = process.env.KDF_RPC_TIMEOUT_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_TIMEOUT_MS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function parseErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name?: string }).name || "");
    if (name === "AbortError") {
      return "KDF RPC request timed out. Check KDF_RPC_URL and KDF responsiveness.";
    }
  }

  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown KDF RPC error";
}

async function doRpcCall<T = JsonValue>(
  method: string,
  params: JsonObject = {},
): Promise<T> {
  const url = getRequiredEnv("KDF_RPC_URL");
  const userpass = process.env.KDF_RPC_USERPASS;
  const spec = KDF_RPC_METHOD_SPECS[method] || {
    ...DEFAULT_KDF_RPC_METHOD_SPEC,
    method,
  };
  const timeoutMs = getTimeoutMs();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const envelope: KdfRpcEnvelope = {
    method,
  };

  if (spec.requiresPayload && Object.keys(params).length === 0) {
    await logDebugEvent({
      severity: "warning",
      title: "KDF RPC payload warning",
      body: `Method marked as payload-required was called without params: ${method}`,
      details: {
        apiVersion: spec.apiVersion,
        description: spec.description,
      },
    });
  }

  if (spec.apiVersion === "2.0") {
    envelope.mmrpc = "2.0";
    envelope.params = params;
  } else {
    Object.assign(envelope, params);
  }

  if (userpass) {
    envelope.userpass = userpass;
  }

  await logDebugEvent({
    severity: "trace",
    title: "KDF RPC request",
    body: `Sending RPC method=${method}`,
    details: {
      ...envelope,
      apiVersion: spec.apiVersion,
      description: spec.description,
    },
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      const isAuth = response.status === 401 || response.status === 403;
      const hint = isAuth
        ? " (check KDF_RPC_USERPASS / auth settings)"
        : "";
      await logDebugEvent({
        severity: "error",
        title: "KDF RPC transport error",
        body: `HTTP ${response.status} on method=${method}`,
        details: text,
      });
      throw new Error(`KDF RPC HTTP ${response.status}${hint}: ${text || "no response body"}`);
    }

    let payload: JsonObject & KdfRpcError;
    try {
      payload = (await response.json()) as JsonObject & KdfRpcError;
    } catch (error) {
      await logDebugEvent({
        severity: "error",
        title: "KDF RPC parse error",
        body: `Unable to parse JSON response for method=${method}`,
        details: parseErrorMessage(error),
      });
      throw error;
    }

    await logDebugEvent({
      severity: "debug",
      title: "KDF RPC response",
      body: `Received RPC method=${method}`,
      details: payload,
    });

    if (payload.error || payload.error_message) {
      await logDebugEvent({
        severity: "error",
        title: "KDF RPC method error",
        body: `RPC method=${method} returned error payload`,
        details: payload,
      });
      throw new Error(payload.error_message || payload.error || "KDF returned an error");
    }

    if ("result" in payload) {
      return payload.result as T;
    }

    if ("response" in payload) {
      await logDebugEvent({
        severity: "debug",
        title: "KDF RPC response wrapper",
        body: `Using payload.response as result for method=${method}`,
        details: payload,
      });

      return payload.response as T;
    }

    await logDebugEvent({
      severity: "debug",
      title: "KDF RPC direct payload fallback",
      body: `No result/response wrapper for method=${method}; using root payload`,
      details: payload,
    });

    return payload as T;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const fetchFailure = /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(rawMessage);
    if (fetchFailure) {
      await logDebugEvent({
        severity: "error",
        title: "KDF RPC unreachable",
        body: `Unable to reach KDF endpoint for method=${method}`,
        details: {
          url,
          message: rawMessage,
        },
      });
      throw new Error(`KDF RPC unreachable at ${url}: ${rawMessage}`);
    }

    await logDebugEvent({
      severity: "error",
      title: "KDF RPC exception",
      body: `Exception during RPC method=${method}`,
      details: parseErrorMessage(error),
    });
    throw new Error(parseErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function callKdfRpc<T = JsonValue>(
  method: string,
  params: JsonObject = {},
): Promise<T> {
  return doRpcCall<T>(method, params);
}

// ---------------------------------------------------------------------------
// Maker order primitives
// ---------------------------------------------------------------------------

export interface SetMakerOrderParams {
  base: string;
  rel: string;
  /** Price as a decimal string: how much rel per 1 base. */
  price: string;
  /** Base coin amount as a decimal string. */
  volume: string;
  min_volume?: string;
  /**
   * When true, any existing maker order for the same base/rel pair is
   * cancelled before the new one is created. Defaults to true here so
   * that every apply is idempotent.
   */
  cancel_previous?: boolean;
  base_confs?: number;
  base_nota?: boolean;
  rel_confs?: number;
  rel_nota?: boolean;
}

/**
 * Place a maker order via KDF `setprice`.
 * Always sets cancel_previous=true unless overridden, making each call idempotent
 * for a given pair. Returns the created order object from KDF.
 */
export async function setMakerOrder(params: SetMakerOrderParams): Promise<JsonObject> {
  return callKdfRpc<JsonObject>("setprice", {
    cancel_previous: true,
    ...params,
  });
}

// ---------------------------------------------------------------------------
// Orderbook
// ---------------------------------------------------------------------------

export interface OrderbookRawEntry {
  uuid?: string;
  coin?: string;
  address?: string;
  price?: JsonValue;
  maxvolume?: JsonValue;
  min_volume?: JsonValue;
  pubkey?: string;
  [key: string]: JsonValue | undefined;
}

export interface OrderbookRaw {
  /** Asks side: entries offering to sell `base` for `rel`. */
  asks?: OrderbookRawEntry[];
  /** Bids side: entries offering to sell `rel` for `base`. */
  bids?: OrderbookRawEntry[];
}

/**
 * Fetch the orderbook for a single directional pair.
 * Returns the raw KDF payload; callers are responsible for normalisation.
 */
/**
 * Cancel all maker orders for a specific base/rel pair.
 * Returns the list of cancelled order UUIDs.
 */
export async function cancelAllOrdersForPair(
  base: string,
  rel: string,
): Promise<string[]> {
  const result = await callKdfRpc<JsonObject>("cancel_all_orders", {
    cancel_by: { type: "Pair", data: { base, rel } },
  });
  const cancelled = result.cancelled;
  if (Array.isArray(cancelled)) {
    return cancelled.filter((id): id is string => typeof id === "string");
  }
  // KDF sometimes nests inside result.result
  if (result.result && typeof result.result === "object" && !Array.isArray(result.result)) {
    const inner = (result.result as JsonObject).cancelled;
    if (Array.isArray(inner)) {
      return inner.filter((id): id is string => typeof id === "string");
    }
  }
  return [];
}

export async function fetchOrderbookRaw(base: string, rel: string): Promise<OrderbookRaw> {
  return callKdfRpc<OrderbookRaw>("orderbook", { base, rel });
}

// ---------------------------------------------------------------------------
// Taker order primitives
// ---------------------------------------------------------------------------

export interface PlaceTakerOrderParams {
  base: string;
  rel: string;
  /** Minimum rel per base the taker will accept (sell) or maximum willing to pay (buy). */
  price: string;
  /** Base coin amount as a decimal string. */
  volume: string;
  [key: string]: string;
}

/**
 * Place a taker sell order via KDF `sell`.
 * Sells `volume` of `base` for at least `price` of `rel` per base unit.
 * KDF will broadcast the request on P2P and match against existing makers.
 */
export async function placeTakerSell(params: PlaceTakerOrderParams): Promise<JsonObject> {
  return callKdfRpc<JsonObject>("sell", params);
}

export interface StatusViewRaw {
  [key: string]: JsonValue;
}

export interface OrderViewRaw {
  [key: string]: JsonValue;
}

export interface WalletViewRaw {
  [key: string]: JsonValue;
}

export interface MovementViewRaw {
  [key: string]: JsonValue;
}

export interface TxHistoryRaw {
  [key: string]: JsonValue;
}

export interface TxHistoryRawResponse {
  available: boolean;
  method?: string;
  message?: string;
  rows: TxHistoryRaw[];
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asObjectRecord(value: JsonValue | undefined): Record<string, JsonObject> {
  if (!isJsonObject(value)) return {};

  const out: Record<string, JsonObject> = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonObject(item)) {
      out[key] = item;
    }
  }
  return out;
}

export interface OptionalRpcResponse {
  available: boolean;
  result?: JsonValue;
  method?: string;
  message?: string;
}

export interface MovementsRawResponse {
  available: boolean;
  method?: string;
  message?: string;
  rows: MovementViewRaw[];
}

function isMethodNotAvailableError(message: string): boolean {
  return /no such method|unknown method|method.*not found|is not supported/i.test(message);
}

async function tryOptionalRpc(methods: string[]): Promise<OptionalRpcResponse> {
  for (const method of methods) {
    if (unsupportedMethodsCache.has(method)) {
      await logDebugEvent({
        severity: "debug",
        title: "Optional RPC skipped",
        body: `Skipping cached unsupported method=${method}`,
      });
      continue;
    }

    try {
      const result = await doRpcCall<JsonValue>(method);
      return { available: true, result, method };
    } catch (error) {
      const message = parseErrorMessage(error);
      if (isMethodNotAvailableError(message)) {
        unsupportedMethodsCache.add(method);
        await logDebugEvent({
          severity: "warning",
          title: "Optional RPC unavailable",
          body: `Method is not available and was cached as unsupported: ${method}`,
          details: message,
        });
        continue;
      }
      await logDebugEvent({
        severity: "error",
        title: "Optional RPC failed",
        body: `Optional method call failed: ${method}`,
        details: message,
      });
      return { available: false, message };
    }
  }

  return {
    available: false,
    message: `None of the optional RPC methods are available: ${methods.join(", ")}`,
  };
}

export async function fetchSimpleMmStatus(): Promise<StatusViewRaw> {
  return doRpcCall<StatusViewRaw>("get_simple_market_maker_status");
}

export interface SimpleMmStatusOptionalResponse {
  available: boolean;
  message?: string;
  raw?: StatusViewRaw;
}

export async function fetchSimpleMmStatusOptional(): Promise<SimpleMmStatusOptionalResponse> {
  const optional = await tryOptionalRpc(["get_simple_market_maker_status"]);

  if (!optional.available) {
    return {
      available: false,
      message:
        optional.message ||
        "get_simple_market_maker_status is not available in this KDF build.",
    };
  }

  const result = optional.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      available: true,
      raw: result as StatusViewRaw,
    };
  }

  await logDebugEvent({
    severity: "warning",
    title: "Simple MM status unexpected shape",
    body: "Simple MM status RPC returned non-object payload",
    details: result,
  });

  return {
    available: false,
    message: "Simple MM status RPC returned a non-object payload.",
  };
}

export async function fetchOrdersRaw(): Promise<OrderViewRaw[]> {
  const result = await doRpcCall<JsonValue>("my_orders");
  if (Array.isArray(result)) {
    return result.filter((x): x is OrderViewRaw => typeof x === "object" && x !== null);
  }

  if (isJsonObject(result)) {
    const hasMakerOrdersField = Object.prototype.hasOwnProperty.call(result, "maker_orders");
    const hasTakerOrdersField = Object.prototype.hasOwnProperty.call(result, "taker_orders");
    const makerOrders = asObjectRecord(result.maker_orders);
    const takerOrders = asObjectRecord(result.taker_orders);

    const flatten = (
      source: Record<string, JsonObject>,
      side: "maker" | "taker",
    ): OrderViewRaw[] =>
      Object.entries(source).map(([uuid, order]) => ({
        ...order,
        uuid,
        order_type: side,
      }));

    const combined = [...flatten(makerOrders, "maker"), ...flatten(takerOrders, "taker")];
    if (combined.length > 0) {
      return combined;
    }

    if (hasMakerOrdersField || hasTakerOrdersField) {
      // Empty maker_orders/taker_orders is a valid "no active orders" response shape.
      return [];
    }

    const maybeOrders = result.orders;
    if (Array.isArray(maybeOrders)) {
      return maybeOrders.filter((x): x is OrderViewRaw => typeof x === "object" && x !== null);
    }
  }

  await logDebugEvent({
    severity: "warning",
    title: "Orders unexpected shape",
    body: "my_orders returned no recognized order data fields",
    details: result,
  });

  return [];
}

export async function fetchWalletsRaw(): Promise<WalletViewRaw[]> {
  const enabledCoins = await doRpcCall<JsonValue>("get_enabled_coins");
  if (!Array.isArray(enabledCoins)) {
    await logDebugEvent({
      severity: "warning",
      title: "Wallets unexpected shape",
      body: "get_enabled_coins returned non-array payload",
      details: enabledCoins,
    });
    return [];
  }

  const basicRows = enabledCoins.filter((x): x is WalletViewRaw => typeof x === "object" && x !== null);

  const withBalances = await Promise.all(
    basicRows.map(async (row) => {
      const ticker = typeof row.ticker === "string" ? row.ticker : undefined;
      if (!ticker) return row;

      try {
        const balanceResult = await doRpcCall<JsonValue>("my_balance", { coin: ticker });
        if (isJsonObject(balanceResult)) {
          return {
            ...row,
            coin: balanceResult.coin ?? ticker,
            ticker,
            address: balanceResult.address ?? row.address,
            balance: balanceResult.balance,
            unspendable_balance: balanceResult.unspendable_balance,
            spendable_balance: balanceResult.spendable_balance,
            available: balanceResult.available,
            required_confirmations: balanceResult.required_confirmations,
          };
        }

        await logDebugEvent({
          severity: "warning",
          title: "Wallet balance unexpected shape",
          body: `my_balance returned non-object result for coin=${ticker}`,
          details: balanceResult,
        });
      } catch {
        // Keep lightweight behavior: return base enabled-coins row even if balance request fails.
        await logDebugEvent({
          severity: "error",
          title: "Wallet balance RPC exception",
          body: `my_balance failed for coin=${ticker}`,
        });
      }

      return row;
    }),
  );

  return withBalances;
}

/**
 * Fetch balance for a single coin. Returns null if the coin is not enabled or
 * the RPC call fails for any reason. Safe to call speculatively.
 */
export async function fetchCoinBalanceSafe(ticker: string): Promise<WalletViewRaw | null> {
  try {
    const result = await doRpcCall<JsonValue>("my_balance", { coin: ticker });
    if (isJsonObject(result)) {
      return {
        coin: result.coin ?? ticker,
        ticker,
        address: result.address,
        balance: result.balance,
        unspendable_balance: result.unspendable_balance,
        spendable_balance: result.spendable_balance,
        available: result.available,
        required_confirmations: result.required_confirmations,
      } as WalletViewRaw;
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchMovementsRaw(): Promise<MovementViewRaw[]> {
  const result = await doRpcCall<JsonValue>("my_recent_swaps");
  if (Array.isArray(result)) {
    return result.filter((x): x is MovementViewRaw => typeof x === "object" && x !== null);
  }
  if (result && typeof result === "object") {
    const maybeSwaps = (result as JsonObject).swaps;
    if (Array.isArray(maybeSwaps)) {
      return maybeSwaps.filter((x): x is MovementViewRaw => typeof x === "object" && x !== null);
    }
  }

  await logDebugEvent({
    severity: "warning",
    title: "Movements unexpected shape",
    body: "my_recent_swaps returned no recognized swaps payload",
    details: result,
  });

  return [];
}

export async function fetchMovementsRawWithAvailability(): Promise<MovementsRawResponse> {
  const optionalResponse = await tryOptionalRpc(["my_recent_swaps"]);

  if (!optionalResponse.available) {
    return {
      available: false,
      message:
        optionalResponse.message ||
        "Movements RPC is not yet available from backend integration.",
      rows: [],
    };
  }

  const result = optionalResponse.result;
  if (Array.isArray(result)) {
    return {
      available: true,
      method: optionalResponse.method,
      rows: result.filter((x): x is MovementViewRaw => typeof x === "object" && x !== null),
    };
  }

  if (result && typeof result === "object") {
    const maybeSwaps = (result as JsonObject).swaps;
    if (Array.isArray(maybeSwaps)) {
      return {
        available: true,
        method: optionalResponse.method,
        rows: maybeSwaps.filter((x): x is MovementViewRaw => typeof x === "object" && x !== null),
      };
    }
  }

  return {
    available: true,
    rows: [],
    message: "Movements RPC returned no rows in a recognized shape.",
  };
}

export async function fetchVersionOptional(): Promise<OptionalRpcResponse> {
  return tryOptionalRpc(["version", "get_version"]);
}

export async function fetchTxHistoryRawOptional(
  coin: string,
  limit = 20,
): Promise<TxHistoryRawResponse> {
  const method = "my_tx_history";
  if (unsupportedMethodsCache.has(method)) {
    return {
      available: false,
      message: "my_tx_history is not available in this KDF build.",
      rows: [],
    };
  }

  try {
    const result = await doRpcCall<JsonValue>(method, {
      coin,
      limit,
      page_number: 1,
    });

    if (Array.isArray(result)) {
      return {
        available: true,
        method,
        rows: result.filter((x): x is TxHistoryRaw => typeof x === "object" && x !== null),
      };
    }

    if (isJsonObject(result)) {
      const candidates = [result.transactions, result.result, result.items];
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
          return {
            available: true,
            method,
            rows: candidate.filter((x): x is TxHistoryRaw => typeof x === "object" && x !== null),
          };
        }

        if (isJsonObject(candidate) && Array.isArray(candidate.transactions)) {
          return {
            available: true,
            method,
            rows: candidate.transactions.filter(
              (x): x is TxHistoryRaw => typeof x === "object" && x !== null,
            ),
          };
        }
      }
    }

    return {
      available: true,
      method,
      rows: [],
      message: "my_tx_history returned no rows in a recognized shape.",
    };
  } catch (error) {
    const message = parseErrorMessage(error);
    if (isMethodNotAvailableError(message)) {
      unsupportedMethodsCache.add(method);
      return {
        available: false,
        method,
        message: "my_tx_history is not available in this KDF build.",
        rows: [],
      };
    }

    return {
      available: false,
      method,
      message,
      rows: [],
    };
  }
}
