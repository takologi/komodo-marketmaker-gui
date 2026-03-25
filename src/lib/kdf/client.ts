import "server-only";

import { JsonObject, JsonValue, KdfRpcEnvelope, KdfRpcError } from "@/lib/kdf/types";

const DEFAULT_TIMEOUT_MS = 15_000;

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
  const timeoutMs = getTimeoutMs();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const envelope: KdfRpcEnvelope = {
    method,
    mmrpc: "2.0",
    ...params,
  };

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
    try {
      const result = await doRpcCall<JsonValue>(method);
      return { available: true, result, method };
    } catch (error) {
      const message = parseErrorMessage(error);
      if (isMethodNotAvailableError(message)) {
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

export async function fetchOrdersRaw(): Promise<OrderViewRaw[]> {
  const result = await doRpcCall<JsonValue>("my_orders");
  if (Array.isArray(result)) {
    return result.filter((x): x is OrderViewRaw => typeof x === "object" && x !== null);
  }
  if (result && typeof result === "object") {
    const maybeOrders = (result as JsonObject).orders;
    if (Array.isArray(maybeOrders)) {
      return maybeOrders.filter((x): x is OrderViewRaw => typeof x === "object" && x !== null);
    }
  }
  return [];
}

export async function fetchWalletsRaw(): Promise<WalletViewRaw[]> {
  const result = await doRpcCall<JsonValue>("get_enabled_coins");
  if (Array.isArray(result)) {
    return result.filter((x): x is WalletViewRaw => typeof x === "object" && x !== null);
  }
  return [];
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
