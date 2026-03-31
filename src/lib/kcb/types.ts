import { JsonObject, JsonValue } from "@/lib/kdf/types";
import { DebugSeverity } from "@/lib/debug/severity";

export type CommandPriority = "high" | "normal";
export type CommandStatus = "queued" | "running" | "done" | "failed";

export interface KcbCommandRecord {
  id: string;
  type: string;
  priority: CommandPriority;
  status: CommandStatus;
  created_at: string;
  finished_at: string | null;
  summary?: JsonValue;
  error_message?: string;
}

export interface CoinActivationServer {
  url: string;
}
export interface CoinActivationSpec {
  method: string;
  params?: JsonObject;
  servers?: CoinActivationServer[];
}

export interface BootstrapCoinConfig {
  coin: string;
  activation: CoinActivationSpec;
}

/**
 * A single maker order placed directly by KCB via setprice.
 * Used in Phase 1 (direct order placement) and as the mechanism
 * for the KCB price-oracle phases that follow.
 */
export interface DirectOrderConfig {
  base: string;
  rel: string;
  /** Price as a decimal string, e.g. "1.02" (how much rel per 1 base). */
  price: string;
  /** Base coin volume as a decimal string, e.g. "10". */
  volume: string;
  min_volume?: string;
  base_confs?: number;
  base_nota?: boolean;
  rel_confs?: number;
  rel_nota?: boolean;
}

export interface BootstrapConfig {
  version: number;
  kcb_log_level: DebugSeverity;
  coins: BootstrapCoinConfig[];
  /**
   * Maker orders KCB places directly via setprice on each apply.
   * cancel_previous=true is always passed, making apply idempotent.
   */
  direct_orders?: DirectOrderConfig[];
  simple_mm: {
    enabled: boolean;
    start_on_apply: boolean;
    start_payload?: JsonObject;
  };
}

export interface LastApplyState {
  applied_at: string;
  ok: boolean;
  summary: JsonObject;
  errors: string[];
}

export interface BootstrapStatusState {
  updated_at: string;
  status: "idle" | "applying" | "done" | "failed";
  message: string;
}

export interface CoinSourceConfig {
  coins_config_url: string;
  icons_base_url: string;
}

export interface CoinCacheMeta {
  fetched_at: string;
  source_url: string;
  item_count: number;
}
