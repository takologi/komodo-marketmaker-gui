import { StatusViewRaw } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

interface RawPairStatus {
  pair: string;
  enabled: boolean;
  hasActiveOrder: boolean;
}

export interface StatusView {
  healthy: boolean;
  state: string;
  runningSeconds: number;
  strategy: string;
  pair: string;
  configuredPairs: string[];
  enabledPairs: string[];
  activeOrderPairs: string[];
}

function parsePairStatuses(raw: StatusViewRaw): RawPairStatus[] {
  const pairs = raw.pairs;
  if (!Array.isArray(pairs)) return [];

  return pairs
    .map((item): RawPairStatus | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const pair = asString((item as StatusViewRaw).pair, "");
      if (!pair) return null;

      return {
        pair,
        enabled: Boolean((item as StatusViewRaw).enabled),
        hasActiveOrder: Boolean((item as StatusViewRaw).has_active_order),
      };
    })
    .filter((row): row is RawPairStatus => Boolean(row));
}

export function adaptStatus(raw: StatusViewRaw): StatusView {
  const state = asString(raw.bot_state ?? raw.state ?? raw.status, "unknown");
  const strategy = asString(raw.strategy, "simple-mm");
  const pairStatuses = parsePairStatuses(raw);
  const configuredPairs = pairStatuses.map((row) => row.pair);
  const enabledPairs = pairStatuses.filter((row) => row.enabled).map((row) => row.pair);
  const activeOrderPairs = pairStatuses
    .filter((row) => row.hasActiveOrder)
    .map((row) => row.pair);
  const pair =
    configuredPairs[0] ||
    asString(raw.trading_pair ?? raw.pair, "not configured");
  const runningSeconds = asNumber(raw.running_seconds ?? raw.uptime_sec, 0);
  const healthy = ["ok", "running", "active"].includes(state.toLowerCase());

  return {
    healthy,
    state,
    strategy,
    pair,
    runningSeconds,
    configuredPairs,
    enabledPairs,
    activeOrderPairs,
  };
}
