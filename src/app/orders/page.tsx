"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Nav } from "@/components/nav";
import { ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { OrderbookEntry, PairOrderbook, ResolvedPair } from "@/lib/kcb/types";

// ---------------------------------------------------------------------------
// Per-pair override state — stored in localStorage, survives page reload.
// ---------------------------------------------------------------------------

interface PairOverride {
  /** When true, base and rel are visually swapped. */
  swapped: boolean;
  /** When true, this pair's section is removed from the Orders page. */
  hidden: boolean;
  showAllOrders: boolean;
}

const LS_KEY = "kcb:pair-overrides";

function loadOverrides(): Record<string, PairOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PairOverride>) : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Record<string, PairOverride>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage unavailable — runtime overrides are session-only.
  }
}

function pairKey(base: string, rel: string): string {
  return `${base}/${rel}`;
}

// ---------------------------------------------------------------------------
// Orderbook section per pair
// ---------------------------------------------------------------------------

function useOrderbook(base: string, rel: string, enabled: boolean) {
  return usePolling<PairOrderbook>(enabled ? `/api/kcb/orderbook?base=${base}&rel=${rel}` : "");
}

function OrderEntry({ entry, label }: { entry: OrderbookEntry; label: string }) {
  return (
    <tr className={entry.mine ? "mine" : undefined}>
      <td>
        {entry.mine ? <span title="Your order" style={{ marginRight: "0.3em" }}>●</span> : null}
        {label}
      </td>
      <td style={{ textAlign: "right" }}>{entry.price.toFixed(8)}</td>
      <td style={{ textAlign: "right" }}>{entry.volume.toFixed(8)}</td>
    </tr>
  );
}

function PairSection({
  pair,
  override,
  onSwap,
  onHide,
  onToggleAllOrders,
}: {
  pair: ResolvedPair;
  override: PairOverride;
  onSwap: () => void;
  onHide: () => void;
  onToggleAllOrders: () => void;
}) {
  const effectiveShowAll = override.showAllOrders;
  const displayBase = override.swapped ? pair.rel : pair.base;
  const displayRel = override.swapped ? pair.base : pair.rel;

  const { data: orderbookData, loading, error } = useOrderbook(
    displayBase,
    displayRel,
    true,
  );

  const asks = orderbookData?.asks ?? [];
  const bids = orderbookData?.bids ?? [];

  const mineAsks = asks.filter((e) => e.mine);
  const mineBids = bids.filter((e) => e.mine);
  const visibleAsks = effectiveShowAll ? asks : mineAsks;
  const visibleBids = effectiveShowAll ? bids : mineBids;

  const totalOrders = asks.length + bids.length;
  const mineOrders = mineAsks.length + mineBids.length;

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          {displayBase}/{displayRel}
          {orderbookData ? (
            <span
              className="muted"
              style={{ fontWeight: "normal", fontSize: "0.8em", marginLeft: "0.5em" }}
              title={`${mineOrders} of your orders / ${totalOrders} total orders`}
            >
              ({mineOrders}/{totalOrders})
            </span>
          ) : null}
        </h3>
        <button onClick={onSwap} title="Swap pair direction" style={{ fontSize: "0.8em" }}>
          ⇄ Swap sides
        </button>
        <label style={{ fontSize: "0.85em", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked onChange={onHide} />
          Visible
        </label>
        <label style={{ fontSize: "0.85em", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={effectiveShowAll} onChange={onToggleAllOrders} />
          Show all orders
        </label>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : visibleAsks.length === 0 && visibleBids.length === 0 ? (
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          {effectiveShowAll
            ? "No orders for this pair."
            : "No your orders for this pair. Enable \u201cShow all orders\u201d to see others."}
        </p>
      ) : (
        <table className="table" style={{ marginTop: "0.6rem" }}>
          <thead>
            <tr>
              <th>Side</th>
              <th style={{ textAlign: "right" }}>Price ({displayRel}/{displayBase})</th>
              <th style={{ textAlign: "right" }}>Volume ({displayBase})</th>
            </tr>
          </thead>
          <tbody>
            {visibleAsks.map((e) => (
              <OrderEntry key={`ask-${e.uuid}`} entry={e} label={`Ask (sell ${displayBase})`} />
            ))}
            {visibleBids.map((e) => (
              <OrderEntry key={`bid-${e.uuid}`} entry={e} label={`Bid (buy ${displayBase})`} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main orders page
// ---------------------------------------------------------------------------

export default function OrdersPage() {
  const { data: pairs, loading: pairsLoading, error: pairsError } = usePolling<ResolvedPair[]>(
    "/api/kcb/pairs",
  );

  const [overrides, setOverrides] = useState<Record<string, PairOverride>>({});

  useEffect(() => {
    setOverrides(loadOverrides());
  }, []);

  // When a pair's server-side `show` transitions from false → true (Admin made
  // it visible again), clear any localStorage hidden override for that pair so
  // it reappears on the Orders page without requiring a manual localStorage clear.
  const prevShowRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!pairs) return;
    const cleared: string[] = [];
    for (const pair of pairs) {
      const key = pairKey(pair.base, pair.rel);
      if (prevShowRef.current[key] === false && pair.show === true) {
        cleared.push(key);
      }
      prevShowRef.current[key] = pair.show;
    }
    if (cleared.length > 0) {
      setOverrides((curr) => {
        const updated = { ...curr };
        for (const key of cleared) {
          if (updated[key]) {
            updated[key] = { ...updated[key], hidden: false };
          }
        }
        saveOverrides(updated);
        return updated;
      });
    }
  }, [pairs]);

  const getOverride = useCallback(
    (pair: ResolvedPair): PairOverride => {
      const key = pairKey(pair.base, pair.rel);
      const stored = overrides[key];
      if (stored) return stored;
      return {
        swapped: false,
        hidden: !pair.show,
        showAllOrders: pair.show_all_orders,
      };
    },
    [overrides],
  );

  function updateOverride(pair: ResolvedPair, patch: Partial<PairOverride>) {
    const key = pairKey(pair.base, pair.rel);
    const current = overrides[key] ?? {
      swapped: false,
      hidden: !pair.show,
      showAllOrders: pair.show_all_orders,
    };
    const updated = { ...overrides, [key]: { ...current, ...patch } };
    setOverrides(updated);
    saveOverrides(updated);
  }

  if (pairsLoading) {
    return (
      <main className="page">
        <Nav />
        <LoadingState />
      </main>
    );
  }

  if (pairsError) {
    return (
      <main className="page">
        <Nav />
        <ErrorState message={pairsError} />
      </main>
    );
  }

  const resolvedPairs = pairs ?? [];
  const visiblePairs = resolvedPairs.filter((pair) => !getOverride(pair).hidden);
  const hiddenCount = resolvedPairs.length - visiblePairs.length;

  return (
    <main className="page">
      <Nav />
      <section style={{ marginBottom: "0.5rem" }}>
        <h2>Orders</h2>
        {resolvedPairs.length === 0 ? (
          <p className="muted">
            No trading pairs configured. Add <code>direct_orders</code> to bootstrap config to get
            started.
          </p>
        ) : null}
        {hiddenCount > 0 ? (
          <p className="muted" style={{ fontSize: "0.85em" }}>
            {hiddenCount} pair{hiddenCount > 1 ? "s" : ""} hidden — go to{" "}
            <a href="/admin">Admin &rsaquo; Trading pairs</a> to restore visibility.
          </p>
        ) : null}
      </section>

      {visiblePairs.map((pair) => {
        const override = getOverride(pair);
        return (
          <PairSection
            key={pairKey(pair.base, pair.rel)}
            pair={pair}
            override={override}
            onSwap={() => updateOverride(pair, { swapped: !override.swapped })}
            onHide={() => updateOverride(pair, { hidden: true })}
            onToggleAllOrders={() =>
              updateOverride(pair, { showAllOrders: !override.showAllOrders })
            }
          />
        );
      })}
    </main>
  );
}




