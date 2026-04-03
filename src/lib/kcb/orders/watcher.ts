import "server-only";

import { pushPopupNotification } from "@/lib/debug/logger";
import { fetchOrdersRaw } from "@/lib/kdf/client";

// ---------------------------------------------------------------------------
// Maker order watcher
//
// Tracks the UUIDs of maker orders placed by KCB and fires popup notifications
// when they disappear from my_orders without being intentionally cancelled by
// KCB itself — which means an external taker filled them.
//
// Lifecycle:
//   - Call registerMakerOrderUuid() after a successful setMakerOrder call.
//   - Call markIntentionallyCancelled() with the UUIDs returned by
//     cancelAllOrdersForPair, before those orders are re-placed.
//   - Call ensureMakerOrderWatcherStarted() once at startup or first apply.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 10_000;

interface TrackedOrder {
  base: string;
  rel: string;
  price: string;
}

/** UUIDs of maker orders that KCB placed.  Maps uuid → order info for popup labelling. */
const trackedOrders = new Map<string, TrackedOrder>();

/**
 * UUIDs that KCB explicitly cancelled (returned by cancelAllOrdersForPair).
 * These are removed from the tracking without generating a popup when the
 * watcher next sees them missing from my_orders.
 */
const intentionallyCancelled = new Set<string>();

let watcherStarted = false;

/**
 * Register a maker order UUID so the watcher can detect when it is filled
 * by an external taker.
 */
export function registerMakerOrderUuid(uuid: string, info: TrackedOrder): void {
  trackedOrders.set(uuid, info);
  // In case this UUID was previously in the cancel set (reuse), clear it.
  intentionallyCancelled.delete(uuid);
}

/**
 * Mark UUIDs as having been cancelled by KCB itself (e.g., via
 * cancelAllOrdersForPair). The watcher will not generate a "filled" popup
 * for these.
 */
export function markIntentionallyCancelled(uuids: string[]): void {
  for (const uuid of uuids) {
    intentionallyCancelled.add(uuid);
  }
}

async function pollOnce(): Promise<void> {
  if (trackedOrders.size === 0) return;

  let activeUuids: Set<string>;
  try {
    const activeRaw = await fetchOrdersRaw();
    activeUuids = new Set<string>(
      activeRaw
        .map((o) => (typeof o.uuid === "string" ? o.uuid : ""))
        .filter(Boolean),
    );
  } catch {
    return;
  }

  for (const [uuid, info] of trackedOrders) {
    if (activeUuids.has(uuid)) continue;

    // Order is no longer active — determine why.
    trackedOrders.delete(uuid);

    if (intentionallyCancelled.has(uuid)) {
      intentionallyCancelled.delete(uuid);
      // We cancelled this ourselves — no popup needed.
      continue;
    }

    // Not in our cancel list → filled by an external taker.
    pushPopupNotification({
      severity: "info",
      title: "Maker order taken",
      body:
        `Your ${info.base}/${info.rel} maker order @ ${info.price} was filled ` +
        `by an external taker`,
      details: { uuid, base: info.base, rel: info.rel, price: info.price },
    });
  }
}

/**
 * Start the background polling loop that watches for externally-filled
 * maker orders. Safe to call multiple times; only one loop is ever started.
 */
export function ensureMakerOrderWatcherStarted(): void {
  if (watcherStarted) return;
  watcherStarted = true;

  const loop = setInterval(() => {
    void pollOnce();
  }, POLL_INTERVAL_MS);

  // Do not prevent the process from exiting cleanly.
  loop.unref?.();
}
