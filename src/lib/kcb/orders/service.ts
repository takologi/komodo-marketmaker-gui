import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { DirectOrderConfig, OrderbookEntry, PairOrderbook } from "@/lib/kcb/types";
import { fetchOrderbookRaw, fetchOrdersRaw, setMakerOrder } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

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

// ---------------------------------------------------------------------------
// Annotated orderbook
//
// Fetches KDF orderbook for both directions (asks = base→rel, bids = rel→base)
// plus my_orders so every entry can be marked mine=true/false.
// The GUI uses the mine flag to show a visual indicator on own orders.
// ---------------------------------------------------------------------------

/**
 * Build a fully annotated orderbook for a pair.
 * Fetches three KDF calls in parallel: orderbook(base,rel), orderbook(rel,base),
 * my_orders. The result contains asks and bids with each entry tagged mine=true
 * when its UUID is among our open orders.
 */
export async function buildAnnotatedOrderbook(base: string, rel: string): Promise<PairOrderbook> {
  const [asksRaw, bidsRaw, myOrdersRaw] = await Promise.all([
    fetchOrderbookRaw(base, rel).catch(() => ({ asks: [], bids: [] })),
    fetchOrderbookRaw(rel, base).catch(() => ({ asks: [], bids: [] })),
    fetchOrdersRaw().catch(() => []),
  ]);

  // Build a set of our own order UUIDs.
  const myUuids = new Set<string>(
    myOrdersRaw
      .map((o) => (typeof o.uuid === "string" ? o.uuid : ""))
      .filter(Boolean),
  );

  /**
   * Normalise a raw KDF orderbook entries array into typed OrderbookEntry objects.
   *
   * @param invertPriceVolume - Pass true for bid entries fetched from
   *   orderbook(rel, base). KDF returns those prices in (base/rel) units;
   *   we need to invert both price and volume so they are expressed in the
   *   same (rel/base) frame as the asks:
   *     display_price  = 1 / raw_price
   *     display_volume = raw_volume × raw_price   (converts rel units → base units)
   */
  function normaliseEntries(
    entries: typeof asksRaw.asks,
    sortDescending: boolean,
    invertPriceVolume = false,
  ): OrderbookEntry[] {
    const items: OrderbookEntry[] = (entries ?? []).map((entry) => {
      const rawPrice = asNumber(entry.price);
      const rawVolume = asNumber(entry.maxvolume ?? entry.min_volume);
      const price = invertPriceVolume && rawPrice !== 0 ? 1 / rawPrice : rawPrice;
      const volume = invertPriceVolume && rawPrice !== 0 ? rawVolume * rawPrice : rawVolume;
      return {
        uuid: asString(entry.uuid, ""),
        price,
        volume,
        mine: Boolean(entry.uuid && myUuids.has(String(entry.uuid))),
      };
    });

    items.sort((a, b) => sortDescending ? b.price - a.price : a.price - b.price);
    return items;
  }

  // Asks: entries from orderbook(base, rel) — price in (rel/base), volume in base.
  // Sorted price ascending.
  const asks = normaliseEntries(asksRaw.asks, false);

  // Bids: entries from orderbook(rel, base) — their prices are in (base/rel) units
  // (inverted vs. what we want to display). Pass invertPriceVolume=true so that
  //   display_price  = 1 / raw_price      (converts to rel/base)
  //   display_volume = raw_volume × raw_price  (converts from rel units to base units)
  // Sorted price descending (best bid first).
  const bids = normaliseEntries(bidsRaw.asks, true, true);

  await logDebugEvent({
    severity: "debug",
    title: "KCB orderbook built",
    body: `Annotated orderbook for ${base}/${rel}`,
    details: { base, rel, asks: asks.length, bids: bids.length, myOrders: myUuids.size },
  });

  return { base, rel, asks, bids };
}
