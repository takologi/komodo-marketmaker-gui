import { StatusViewRaw } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

export interface StatusView {
  healthy: boolean;
  state: string;
  runningSeconds: number;
  strategy: string;
  pair: string;
}

export function adaptStatus(raw: StatusViewRaw): StatusView {
  const state = asString(raw.state ?? raw.status, "unknown");
  const strategy = asString(raw.strategy, "simple-mm");
  const pair = asString(raw.trading_pair ?? raw.pair, "not configured");
  const runningSeconds = asNumber(raw.running_seconds ?? raw.uptime_sec, 0);
  const healthy = ["ok", "running", "active"].includes(state.toLowerCase());

  return {
    healthy,
    state,
    strategy,
    pair,
    runningSeconds,
  };
}
