import "server-only";

export type KdfRpcApiVersion = "legacy" | "2.0";

export interface KdfRpcMethodSpec {
  method: string;
  apiVersion: KdfRpcApiVersion;
  description: string;
  requiresPayload?: boolean;
}

export const KDF_RPC_METHOD_SPECS: Record<string, KdfRpcMethodSpec> = {
  get_simple_market_maker_status: {
    method: "get_simple_market_maker_status",
    apiVersion: "legacy",
    description: "Read simple market maker status",
  },
  my_orders: {
    method: "my_orders",
    apiVersion: "legacy",
    description: "Read active orders",
  },
  get_enabled_coins: {
    method: "get_enabled_coins",
    apiVersion: "legacy",
    description: "Read enabled wallet coins",
  },
  my_balance: {
    method: "my_balance",
    apiVersion: "legacy",
    description: "Read wallet balance for a coin",
    requiresPayload: true,
  },
  my_recent_swaps: {
    method: "my_recent_swaps",
    apiVersion: "legacy",
    description: "Read recent swaps/movements",
  },
  version: {
    method: "version",
    apiVersion: "legacy",
    description: "Read KDF version",
  },
  get_version: {
    method: "get_version",
    apiVersion: "legacy",
    description: "Read KDF version (alternative method)",
  },
  start_simple_market_maker_bot: {
    method: "start_simple_market_maker_bot",
    apiVersion: "2.0",
    description: "Start simple market maker bot",
    requiresPayload: true,
  },
  electrum: {
    method: "electrum",
    apiVersion: "legacy",
    description: "Electrum coin activation",
    requiresPayload: true,
  },
  enable: {
    method: "enable",
    apiVersion: "legacy",
    description: "Generic coin enable/activation",
    requiresPayload: true,
  },
  setprice: {
    method: "setprice",
    apiVersion: "legacy",
    description: "Place a maker order; cancel_previous cancels any existing order for the same pair",
    requiresPayload: true,
  },
  cancel_order: {
    method: "cancel_order",
    apiVersion: "legacy",
    description: "Cancel a maker order by UUID",
    requiresPayload: true,
  },
};

export const DEFAULT_KDF_RPC_METHOD_SPEC: KdfRpcMethodSpec = {
  method: "<unknown>",
  apiVersion: "legacy",
  description: "Fallback to legacy RPC envelope when method is not listed",
};
