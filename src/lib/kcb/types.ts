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

// ---------------------------------------------------------------------------
// GUI policy — display preferences for trading pairs
// Stored in ~/.kcb/config/gui-policy.json
// Separate from bootstrap: has no KCB/KDF runtime consequences.
// ---------------------------------------------------------------------------

export interface GuiPairPolicy {
  base: string;
  rel: string;
  /** Whether to show this pair's section in the Orders screen. Default: true. */
  show?: boolean;
  /** Whether to show orders from all market participants or only own orders. Default: false. */
  show_all_orders?: boolean;
}

export interface GuiPolicy {
  version: number;
  trading_pairs: GuiPairPolicy[];
}

// ---------------------------------------------------------------------------
// Resolved pair — output of the pair resolver (bootstrap auto-config merged
// with gui-policy overrides). Consumed by the GUI via /api/kcb/pairs.
// ---------------------------------------------------------------------------

export interface ResolvedPair {
  base: string;
  rel: string;
  show: boolean;
  show_all_orders: boolean;
  /** How this pair entered the resolved list. */
  source: "direct_orders" | "simple_mm_cfg" | "gui_policy";
}

// ---------------------------------------------------------------------------
// Orderbook — annotated order entries returned by /api/kcb/orderbook.
// KCB joins the KDF orderbook with my_orders to mark each entry as mine/theirs.
// ---------------------------------------------------------------------------

export interface OrderbookEntry {
  uuid: string;
  price: number;
  volume: number;
  /** True when this order's UUID appears in my_orders. */
  mine: boolean;
}

export interface PairOrderbook {
  base: string;
  rel: string;
  /**
   * Asks: offers to sell base for rel.
   * Sorted price ascending (cheapest ask first — classic order book ask side).
   */
  asks: OrderbookEntry[];
  /**
   * Bids: offers to sell rel for base (i.e. buying base with rel).
   * Sorted price descending (highest bid first).
   */
  bids: OrderbookEntry[];
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
