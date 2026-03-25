import { NextResponse } from "next/server";

import { adaptOrders } from "@/lib/kdf/adapters/orders";
import { adaptStatus } from "@/lib/kdf/adapters/status";
import {
  fetchOrdersRaw,
  fetchSimpleMmStatusOptional,
  fetchVersionOptional,
  StatusViewRaw,
} from "@/lib/kdf/client";
import { UiApiResponse } from "@/lib/kdf/types";

interface PairStatus {
  pair: string;
  hasActiveOrders: boolean;
}

interface DashboardStatusView {
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

export async function GET() {
  const fetchedAt = new Date().toISOString();
  try {
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

    const activePairsSet = new Set(
      orders.map((order) => `${order.base}/${order.rel}`.toUpperCase()),
    );

    const normalizedConfiguredPairs = configuredPairs.map((pair) => pair.toUpperCase());
    const pairStatuses: PairStatus[] = normalizedConfiguredPairs.map((pair) => ({
      pair,
      hasActiveOrders: activePairsSet.has(pair),
    }));

    const data: DashboardStatusView = {
      connectionOk: true,
      connectionMessage: "KDF RPC reachable through internal server route",
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
        value: versionOptional.available
          ? String(versionOptional.result ?? "available")
          : "not available",
        sourceMethod: versionOptional.method ?? "none",
        message: versionOptional.message,
      },
    };

    const body: UiApiResponse<typeof data> = { ok: true, data, fetchedAt };
    return NextResponse.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load status";
    const body: UiApiResponse<never> = { ok: false, message, fetchedAt };
    return NextResponse.json(body, { status: 500 });
  }
}
