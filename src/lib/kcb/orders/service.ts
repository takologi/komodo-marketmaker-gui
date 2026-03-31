import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { DirectOrderConfig } from "@/lib/kcb/types";
import { setMakerOrder } from "@/lib/kdf/client";

// ---------------------------------------------------------------------------
// KCB order management — Phase 1: direct order placement
//
// KCB is the strategy layer. It decides what orders exist and at what price.
// KDF is the execution layer. It holds the order book and manages swap lifecycle.
//
// This module is intentionally thin in Phase 1: it places operator-configured
// orders from bootstrap config verbatim. Phases 2+ will add price computation
// logic here before calling setMakerOrder, without changing the call structure
// that interacts with KDF.
// ---------------------------------------------------------------------------

export interface DirectOrderResult {
  base: string;
  rel: string;
  price: string;
  volume: string;
  ok: boolean;
  /** Populated on success — the KDF UUID of the created maker order. */
  uuid?: string;
  /** Populated on failure — human-readable error from KDF or network. */
  error?: string;
}

/**
 * Apply a list of direct order configurations from bootstrap config.
 *
 * Each order calls KDF `setprice` with `cancel_previous=true`, which cancels
 * any existing maker order for the same base/rel pair before creating a new one.
 * This makes apply idempotent: running it twice leaves exactly one order per pair.
 *
 * Orders are placed sequentially to avoid racing KDF order state.
 * Failures are collected and returned; a single failed order does not abort the rest.
 */
export async function applyDirectOrders(orders: DirectOrderConfig[]): Promise<DirectOrderResult[]> {
  const results: DirectOrderResult[] = [];

  for (const order of orders) {
    await logDebugEvent({
      severity: "debug",
      title: "KCB direct order placing",
      body: `Placing maker order ${order.base}/${order.rel} @ ${order.price}`,
      details: {
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        min_volume: order.min_volume,
      },
    });

    try {
      const response = await setMakerOrder({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ...(order.min_volume !== undefined && { min_volume: order.min_volume }),
        ...(order.base_confs !== undefined && { base_confs: order.base_confs }),
        ...(order.base_nota !== undefined && { base_nota: order.base_nota }),
        ...(order.rel_confs !== undefined && { rel_confs: order.rel_confs }),
        ...(order.rel_nota !== undefined && { rel_nota: order.rel_nota }),
      });

      // KDF setprice returns the created order object directly (doRpcCall unwraps result).
      const uuid = typeof response.uuid === "string" ? response.uuid : undefined;

      await logDebugEvent({
        severity: "info",
        title: "KCB direct order placed",
        body: `Maker order ${order.base}/${order.rel} placed`,
        details: { base: order.base, rel: order.rel, price: order.price, uuid },
      });

      results.push({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ok: true,
        uuid,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await logDebugEvent({
        severity: "error",
        title: "KCB direct order failed",
        body: `Failed to place maker order ${order.base}/${order.rel}`,
        details: { base: order.base, rel: order.rel, price: order.price, error: message },
      });

      results.push({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ok: false,
        error: message,
      });
    }
  }

  return results;
}
