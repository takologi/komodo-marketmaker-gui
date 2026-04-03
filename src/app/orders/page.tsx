"use client";

import { useCallback, useEffect, useState } from "react";

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
  onToggleHide,
  onToggleAllOrders,
}: {
  pair: ResolvedPair;
  override: PairOverride;
  onSwap: () => void;
  onToggleHide: () => void;
  onToggleAllOrders: () => void;
}) {
  const effectiveShow = !override.hidden;
  const effectiveShowAll = override.showAllOrders;
  const displayBase = override.swapped ? pair.rel : pair.base;
  const displayRel = override.swapped ? pair.base : pair.rel;

  const { data: orderbookData, loading, error } = useOrderbook(
    displayBase,
    displayRel,
    effectiveShow,
  );

  const asks = orderbookData?.asks ?? [];
  const bids = orderbookData?.bids ?? [];
  const visibleAsks = effectiveShowAll ? asks : asks.filter((e) => e.mine);
  const visibleBids = effectiveShowAll ? bids : bids.filter((e) => e.mine);

  return (
    <div className="card" style={{ marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          {displayBase}/{displayRel}
        </h3>
        <button onClick={onSwap} title="Swap pair direction" style={{ fontSize: "0.8em" }}>
          ⇄ Swap sides
        </button>
        <label style={{ fontSize: "0.85em", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={!override.hidden} onChange={onToggleHide} />
          Visible
        </label>
        <label style={{ fontSize: "0.85em", display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <input type="checkbox" checked={effectiveShowAll} onChange={onToggleAllOrders} />
          Show all orders
        </label>
      </div>

      {!effectiveShow ? (
        <p className="muted" style={{ marginTop: "0.5rem" }}>Pair hidden.</p>
      ) : loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : visibleAsks.length === 0 && visibleBids.length === 0 ? (
        <p className="muted" style={{ marginTop: "0.5rem" }}>No orders for this pair.</p>
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

  const getOverride = useCallback(
    (base: string, rel: string): PairOverride => {
      const key = pairKey(base, rel);
      return overrides[key] ?? { swapped: false, hidden: false, showAllOrders: false };
    },
    [overrides],
  );

  function updateOverride(base: string, rel: string, patch: Partial<PairOverride>) {
    const key = pairKey(base, rel);
    const current = overrides[key] ?? { swapped: false, hidden: false, showAllOrders: false };
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
      </section>

      {resolvedPairs.map((pair) => {
        const stored = getOverride(pair.base, pair.rel);
        const override: PairOverride = {
          swapped: stored.swapped,
          // Prefer localStorage value if it has been explicitly set, else use bootstrap/gui-policy default.
          hidden: Object.prototype.hasOwnProperty.call(overrides, pairKey(pair.base, pair.rel))
            ? stored.hidden
            : !pair.show,
          showAllOrders: Object.prototype.hasOwnProperty.call(
            overrides,
            pairKey(pair.base, pair.rel),
          )
            ? stored.showAllOrders
            : pair.show_all_orders,
        };
        return (
          <PairSection
            key={pairKey(pair.base, pair.rel)}
            pair={pair}
            override={override}
            onSwap={() => updateOverride(pair.base, pair.rel, { swapped: !override.swapped })}
            onToggleHide={() => updateOverride(pair.base, pair.rel, { hidden: !override.hidden })}
            onToggleAllOrders={() =>
              updateOverride(pair.base, pair.rel, { showAllOrders: !override.showAllOrders })
            }
          />
        );
      })}
    </main>
  );
}


