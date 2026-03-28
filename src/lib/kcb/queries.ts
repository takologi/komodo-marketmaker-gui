import "server-only";

import { adaptOrders } from "@/lib/kdf/adapters/orders";
import { adaptStatus } from "@/lib/kdf/adapters/status";
import { adaptWallets } from "@/lib/kdf/adapters/wallets";
import { adaptMovements } from "@/lib/kdf/adapters/movements";
import {
  fetchOrdersRaw,
  fetchSimpleMmStatusOptional,
  fetchVersionOptional,
  fetchWalletsRaw,
  fetchMovementsRawWithAvailability,
  StatusViewRaw,
} from "@/lib/kdf/client";
import { ensureKcbLayout } from "@/lib/kcb/storage";

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
  };
  refreshRateMs: number;
  configuredPairs: string[];
  activeOrderCount: number;
  pairsWithActiveOrders: number;
  activeOrderUuids: string[];
  pairStatuses: PairStatus[];
  version: {
    available: boolean;
    value: string;
    sourceMethod: string;
    message?: string;
  };
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
  const [rawStatusOptional, rawOrders, versionOptional] = await Promise.all([
    fetchSimpleMmStatusOptional(),
    fetchOrdersRaw(),
    fetchVersionOptional(),
  ]);

  const simpleMmStatus = rawStatusOptional.available
    ? adaptStatus(rawStatusOptional.raw ?? emptyStatusRaw())
    : undefined;

  const orders = adaptOrders(rawOrders);
  const activeOrderUuids = orders.map((order) => order.id);
  const configuredPairs = parseConfiguredPairs(
    rawStatusOptional.raw ?? emptyStatusRaw(),
    simpleMmStatus?.pair ?? "not configured",
  );

  const activePairsSet = new Set(orders.map((order) => `${order.base}/${order.rel}`.toUpperCase()));
  const normalizedConfiguredPairs = configuredPairs.map((pair) => pair.toUpperCase());

  const pairStatuses: PairStatus[] = normalizedConfiguredPairs.map((pair) => ({
    pair,
    hasActiveOrders: activePairsSet.has(pair),
  }));

  return {
    connectionOk: true,
    connectionMessage: "KCB connected to KDF RPC adapter",
    simpleMm: {
      available: rawStatusOptional.available,
      status: simpleMmStatus,
      message: rawStatusOptional.message,
    },
    refreshRateMs: Number.parseInt(process.env.NEXT_PUBLIC_POLL_MS ?? "5000", 10) || 5000,
    configuredPairs: normalizedConfiguredPairs,
    activeOrderCount: orders.length,
    pairsWithActiveOrders: pairStatuses.filter((pair) => pair.hasActiveOrders).length,
    activeOrderUuids,
    pairStatuses,
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

export async function getKcbWallets() {
  await ensureKcbLayout();
  const raw = await fetchWalletsRaw();
  return adaptWallets(raw);
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
