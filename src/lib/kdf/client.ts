import "server-only";

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

function getMmrpcVersion(): string | undefined {
  const version = process.env.KDF_RPC_MMRPC_VERSION;
  if (!version) return undefined;
  return version.trim() || undefined;
}

function parseErrorMessage(error: unknown): string {
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
  const mmrpc = getMmrpcVersion();
  const timeoutMs = getTimeoutMs();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const envelope: KdfRpcEnvelope = {
    method,
    ...params,
  };

  if (mmrpc) {
    envelope.mmrpc = mmrpc;
  }

  if (userpass) {
    envelope.userpass = userpass;
  }

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
      throw new Error(`HTTP ${response.status}: ${text || "no response body"}`);
    }

    const payload = (await response.json()) as JsonObject & KdfRpcError;
    if (payload.error || payload.error_message) {
      throw new Error(payload.error_message || payload.error || "KDF returned an error");
    }

    return payload.result as T;
  } catch (error) {
    throw new Error(parseErrorMessage(error));
  } finally {
    clearTimeout(timeoutId);
  }
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
      continue;
    }

    try {
      const result = await doRpcCall<JsonValue>(method);
      return { available: true, result, method };
    } catch (error) {
      const message = parseErrorMessage(error);
      if (isMethodNotAvailableError(message)) {
        unsupportedMethodsCache.add(method);
        continue;
      }
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

    const maybeOrders = result.orders;
    if (Array.isArray(maybeOrders)) {
      return maybeOrders.filter((x): x is OrderViewRaw => typeof x === "object" && x !== null);
    }
  }

  return [];
}

export async function fetchWalletsRaw(): Promise<WalletViewRaw[]> {
  const enabledCoins = await doRpcCall<JsonValue>("get_enabled_coins");
  if (!Array.isArray(enabledCoins)) {
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
          };
        }
      } catch {
        // Keep lightweight behavior: return base enabled-coins row even if balance request fails.
      }

      return row;
    }),
  );

  return withBalances;
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
