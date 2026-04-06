import "server-only";

import { logDebugEvent, pushPopupNotification } from "@/lib/debug/logger";
import { getCoinDefinitions } from "@/lib/kcb/coins/provider";
import { DirectOrderConfig, OrderbookEntry, PairOrderbook } from "@/lib/kcb/types";
import {
  ensureMakerOrderWatcherStarted,
  markIntentionallyCancelled,
  registerMakerOrderUuid,
} from "@/lib/kcb/orders/watcher";
import {
  cancelAllOrdersForPair,
  fetchOrderbookRaw,
  fetchOrdersRaw,
  OrderbookRawEntry,
  placeTakerSell,
  setMakerOrder,
} from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";
import { JsonObject, JsonValue } from "@/lib/kdf/types";

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

/**
 * Volumes below this threshold are treated as zero (floating-point dust guard).
 */
const VOLUME_EPSILON = 1e-8;

const DEFAULT_COIN_DECIMALS = 8;

function findCoinDefinition(coinDefinitions: JsonValue, ticker: string): JsonObject | null {
  const norm = ticker.toUpperCase();
  const visited = new Set<JsonValue>();

  function visit(node: JsonValue): JsonObject | null {
    if (!node || typeof node !== "object") return null;
    if (visited.has(node)) return null;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }

    const obj = node as JsonObject;
    const coin = typeof obj.coin === "string" ? obj.coin.toUpperCase() : "";
    if (coin === norm) return obj;

    const direct = obj[norm];
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct as JsonObject;
    }

    for (const value of Object.values(obj)) {
      const found = visit(value);
      if (found) return found;
    }

    return null;
  }

  return visit(coinDefinitions);
}

function coinDecimals(coinDefinitions: JsonValue, ticker: string): number {
  const coinDef = findCoinDefinition(coinDefinitions, ticker);
  if (!coinDef) return DEFAULT_COIN_DECIMALS;
  const decimals = asNumber(coinDef.decimals, DEFAULT_COIN_DECIMALS);
  return Number.isFinite(decimals) ? Math.max(0, Math.floor(decimals)) : DEFAULT_COIN_DECIMALS;
}

/**
 * A single entry from the reverse orderbook that would cross the proposed order.
 *
 * For a proposed `BASE/REL @ P_ask` (P_ask in REL/BASE), crossing entries come
 * from `orderbook(REL, BASE)` and satisfy:
 *   entry.price (BASE per REL) <= 1 / P_ask
 *
 * Volumes (maxVolumeBase, minVolumeBase) are expressed in BASE units of the
 * proposed order so they can be compared directly to `remaining`.
 */
interface CrossingEntry {
  uuid: string;
  /** KDF entry price: BASE of proposed order per REL of proposed order. */
  priceBasePerRel: number;
  /** Maximum BASE of proposed order we can sell to this entry. */
  maxVolumeBase: number;
  /** Minimum BASE of proposed order required by this entry. */
  minVolumeBase: number;
  /** True when this entry UUID belongs to our own maker orders. */
  mine: boolean;
}

/**
 * Fetch all entries from the reverse orderbook that would cross a proposed
 * `BASE/REL @ askPrice` maker order.
 *
 * Math:
 *   - Fetch `orderbook(REL, BASE)` → entries with price in BASE/REL
 *   - Cross condition:  entry.price <= 1/askPrice
 *   - Volume (in BASE): maxVolumeBase = entry.maxvolume × entry.price
 *
 * Result is sorted ascending by entry price (best fill rate first).
 */
async function fetchCrossingEntries(
  base: string,
  rel: string,
  askPrice: number,
  myUuids: Set<string>,
): Promise<CrossingEntry[]> {
  if (askPrice <= 0) return [];

  const raw = await fetchOrderbookRaw(rel, base).catch(
    (): { asks?: OrderbookRawEntry[] } => ({ asks: [] }),
  );
  const crossThreshold = 1 / askPrice;
  const entries: CrossingEntry[] = [];

  for (const entry of raw.asks ?? []) {
    const p = asNumber(entry.price);
    if (p <= 0 || p > crossThreshold) continue;

    // entry.maxvolume is the REL-of-this-pair volume (= our order's REL).
    // Multiply by p (BASE/REL) to get our BASE volume.
    const maxVolumeBase = asNumber(entry.maxvolume) * p;
    const minVolumeBase = asNumber(entry.min_volume) * p;
    const uuid = asString(entry.uuid, "");

    entries.push({
      uuid,
      priceBasePerRel: p,
      maxVolumeBase,
      minVolumeBase,
      mine: uuid !== "" && myUuids.has(uuid),
    });
  }

  entries.sort((a, b) => a.priceBasePerRel - b.priceBasePerRel);
  return entries;
}

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
 * Strategy (idempotent, supports multiple price levels per pair):
 *   1. Group orders by (base, rel) pair.
 *   2. For each unique pair, cancel ALL existing maker orders for that pair
 *      via cancel_all_orders(Pair). This is safe to call even when no orders
 *      exist.
 *   3. Place every order in the group with cancel_previous=false. Since we
 *      already cleared the slate in step 2, cancel_previous is not needed and
 *      without it KDF places independent orders at each price level.
 *
 * This makes apply idempotent: running it twice results in exactly the orders
 * defined in the config, regardless of what was there before.
 *
 * Orders within each pair are placed sequentially; failures are collected and
 * returned without aborting the rest.
 */
export async function applyDirectOrders(orders: DirectOrderConfig[]): Promise<DirectOrderResult[]> {
  const results: DirectOrderResult[] = [];

  // --- Step 1: group by canonical (base, rel) key -------------------------
  const groups = new Map<string, DirectOrderConfig[]>();
  for (const order of orders) {
    const key = `${order.base}/${order.rel}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(order);
    } else {
      groups.set(key, [order]);
    }
  }

  // Start the watcher that detects external taker fills on our maker orders.
  ensureMakerOrderWatcherStarted();

  // --- Step 2: cancel all existing orders for each unique pair ------------
  for (const [key, group] of groups) {
    const { base, rel } = group[0];
    try {
      const cancelled = await cancelAllOrdersForPair(base, rel);
      markIntentionallyCancelled(cancelled);
      await logDebugEvent({
        severity: "debug",
        title: "KCB direct orders pre-cancel",
        body: `Cancelled ${cancelled.length} existing order(s) for ${key} before re-placing`,
        details: { base, rel, cancelledCount: cancelled.length, cancelledUuids: cancelled },
      });
    } catch (error) {
      // Non-fatal: if cancel fails the subsequent setprice calls will still
      // work (they'll create additional orders). Log and continue.
      await logDebugEvent({
        severity: "warning",
        title: "KCB direct orders pre-cancel failed",
        body: `Failed to cancel existing orders for ${key}; placing orders anyway`,
        details: { base, rel, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  // --- Step 3: place each order with pre-flight crossing check ------------
  //
  // Before placing each order as a maker (setprice), we:
  //   a) Fetch current my_orders UUIDs (re-fetched per order so orders placed
  //      earlier in this batch are included in the self-cross check).
  //   b) Scan the reverse orderbook for entries whose price crosses ours.
  //   c) If any crossing entry is our own → refuse (self-cross protection).
  //   d) For each crossing entry from others → place a taker `sell` to fill
  //      against it, reducing our remaining volume.
  //   e) Place setprice maker for any remaining volume.
  //
  // This is a single-pass implementation (one orderbook snapshot per order).
  // Race conditions between the snapshot and taker broadcast are deferred.
  for (const order of orders) {
    const askPrice = asNumber(order.price);

    if (askPrice <= 0) {
      await logDebugEvent({
        severity: "error",
        title: "KCB direct order invalid",
        body: `Skipping order with invalid price: ${order.price}`,
        details: { base: order.base, rel: order.rel, price: order.price },
      });
      results.push({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ok: false,
        error: `Invalid price: ${order.price}`,
      });
      continue;
    }

    // Re-fetch my_orders each iteration: orders placed in prior iterations of
    // this same batch must be considered candidates for self-cross detection.
    let myUuids: Set<string>;
    try {
      const myOrdersRaw = await fetchOrdersRaw();
      myUuids = new Set<string>(
        myOrdersRaw
          .map((o) => (typeof o.uuid === "string" ? o.uuid : ""))
          .filter(Boolean),
      );
    } catch {
      myUuids = new Set<string>();
    }

    // Pre-flight: find all crossing entries in the reverse orderbook.
    let crossingEntries: CrossingEntry[];
    try {
      crossingEntries = await fetchCrossingEntries(
        order.base,
        order.rel,
        askPrice,
        myUuids,
      );
    } catch {
      crossingEntries = [];
    }

    // Self-cross check: refuse the entire order if any crossing entry is ours.
    // (KDF prevents same-instance self-matching, so placing this as a taker
    // would leave an unmatched order; refusing proactively is the right call.)
    const selfCrossEntry = crossingEntries.find((e) => e.mine);
    if (selfCrossEntry) {
      const msg =
        `Order ${order.base}/${order.rel} @ ${order.price} crosses own maker ` +
        `order ${selfCrossEntry.uuid} — refusing placement`;
      await logDebugEvent({
        severity: "warning",
        title: "KCB direct order self-cross",
        body: msg,
        details: {
          base: order.base,
          rel: order.rel,
          price: order.price,
          crossingUuid: selfCrossEntry.uuid,
        },
      });
      pushPopupNotification({
        severity: "warning",
        title: "Order refused — self-cross",
        body:
          `${order.base}/${order.rel} @ ${order.price} was refused because it ` +
          `crosses your own maker order (${selfCrossEntry.uuid})`,
      });
      results.push({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ok: false,
        error: msg,
      });
      continue;
    }

    // Opportunistic taker fills: iterate crossing entries (best price first)
    // and place `sell` takers to consume them before placing our maker residual.
    let remaining = asNumber(order.volume);

    for (const entry of crossingEntries) {
      if (remaining <= VOLUME_EPSILON) break;

      const fillVol = Math.min(remaining, entry.maxVolumeBase);

      if (fillVol < entry.minVolumeBase) {
        await logDebugEvent({
          severity: "debug",
          title: "KCB taker fill skipped",
          body: `Fill volume ${fillVol} below entry minimum ${entry.minVolumeBase}; skipping`,
          details: { uuid: entry.uuid, fillVol, minVolumeBase: entry.minVolumeBase },
        });
        continue;
      }

      try {
        const takerResult = await placeTakerSell({
          base: order.base,
          rel: order.rel,
          price: order.price,
          volume: String(fillVol),
        });
        const takerUuid =
          typeof takerResult.uuid === "string" ? takerResult.uuid : undefined;
        remaining -= fillVol;

        await logDebugEvent({
          severity: "info",
          title: "KCB taker fill placed",
          body:
            `Placed sell taker ${order.base}/${order.rel} vol=${fillVol} ` +
            `against maker ${entry.uuid}`,
          details: {
            base: order.base,
            rel: order.rel,
            fillVol,
            makerUuid: entry.uuid,
            takerUuid,
          },
        });
        pushPopupNotification({
          severity: "info",
          title: "Taker fill placed",
          body:
            `Filling ${order.base}/${order.rel}: selling ${fillVol} ` +
            `${order.base} against maker order ${entry.uuid}`,
        });
      } catch (fillError) {
        // Taker placement failed; remaining unchanged — will place as maker below.
        await logDebugEvent({
          severity: "warning",
          title: "KCB taker fill failed",
          body: `Failed to place sell taker against entry ${entry.uuid}; will place as maker`,
          details: {
            uuid: entry.uuid,
            error: fillError instanceof Error ? fillError.message : String(fillError),
          },
        });
      }
    }

    if (remaining <= VOLUME_EPSILON) {
      // Entire volume filled via taker orders — no maker residual needed.
      await logDebugEvent({
        severity: "info",
        title: "KCB direct order fully taker-filled",
        body: `Order ${order.base}/${order.rel} @ ${order.price} fully consumed as taker`,
        details: { base: order.base, rel: order.rel, price: order.price },
      });
      results.push({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: order.volume,
        ok: true,
      });
      continue;
    }

    // Place the remaining volume as a maker order.
    await logDebugEvent({
      severity: "debug",
      title: "KCB direct order placing",
      body: `Placing maker order ${order.base}/${order.rel} @ ${order.price} vol=${remaining}`,
      details: {
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: remaining,
        originalVolume: order.volume,
        min_volume: order.min_volume,
      },
    });

    try {
      const response = await setMakerOrder({
        base: order.base,
        rel: order.rel,
        price: order.price,
        volume: String(remaining),
        // cancel_previous=false: we already cancelled the pair's orders above,
        // so multiple independent orders at different price levels can coexist.
        cancel_previous: false,
        ...(order.min_volume !== undefined && { min_volume: order.min_volume }),
        ...(order.base_confs !== undefined && { base_confs: order.base_confs }),
        ...(order.base_nota !== undefined && { base_nota: order.base_nota }),
        ...(order.rel_confs !== undefined && { rel_confs: order.rel_confs }),
        ...(order.rel_nota !== undefined && { rel_nota: order.rel_nota }),
      });

      const uuid = typeof response.uuid === "string" ? response.uuid : undefined;

      await logDebugEvent({
        severity: "info",
        title: "KCB direct order placed",
        body: `Maker order ${order.base}/${order.rel} placed`,
        details: { base: order.base, rel: order.rel, price: order.price, uuid },
      });

      if (uuid) {
        registerMakerOrderUuid(uuid, {
          base: order.base,
          rel: order.rel,
          price: order.price,
        });
      }
      pushPopupNotification({
        severity: "info",
        title: "Maker order placed",
        body:
          `${order.base}/${order.rel} @ ${order.price} — ` +
          `vol ${remaining} ${order.base}` +
          (uuid ? ` (${uuid.slice(0, 8)}…)` : ""),
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
  const [asksRaw, bidsRaw, myOrdersRaw, coinDefinitions] = await Promise.all([
    fetchOrderbookRaw(base, rel).catch(() => ({ asks: [], bids: [] })),
    fetchOrderbookRaw(rel, base).catch(() => ({ asks: [], bids: [] })),
    fetchOrdersRaw().catch(() => []),
    getCoinDefinitions().catch(() => ({} as JsonValue)),
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
  // Sorted price ascending (lowest ask first).
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

  const baseDecimals = coinDecimals(coinDefinitions, base);
  const relDecimals = coinDecimals(coinDefinitions, rel);

  return { base, rel, baseDecimals, relDecimals, asks, bids };
}
