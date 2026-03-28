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

export interface BootstrapConfig {
  version: number;
  kcb_log_level: DebugSeverity;
  coins: BootstrapCoinConfig[];
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
