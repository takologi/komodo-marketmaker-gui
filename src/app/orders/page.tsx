"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Nav } from "@/components/nav";
import { ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { PairOrderbook, ResolvedPair } from "@/lib/kcb/types";
import { WalletViewEnriched } from "@/lib/kdf/adapters/wallets";

// ---------------------------------------------------------------------------
// Per-pair override state — stored in localStorage, survives page reload.
// ---------------------------------------------------------------------------

interface PairOverride {
  /** When true, base and rel are visually swapped. */
  swapped: boolean;
  /** When true, this pair's section is removed from the Orders page. */
  hidden: boolean;
  showAllOrders: boolean;
  milliBase: boolean;
  milliRel: boolean;
}

const LS_KEY = "kcb:pair-overrides";
const LTP_LS_KEY = "kcb:ltp-by-pair";
const NUMERIC_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";

interface LtpMap {
  [pair: string]: number;
}

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

function loadLtpMap(): LtpMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LTP_LS_KEY);
    return raw ? (JSON.parse(raw) as LtpMap) : {};
  } catch {
    return {};
  }
}

function saveLtpMap(map: LtpMap) {
  try {
    localStorage.setItem(LTP_LS_KEY, JSON.stringify(map));
  } catch {
    // best effort persistence only
  }
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

function toFixedSafe(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(decimals);
}

function priceDecimalsFromOrderbook(orderbook: PairOrderbook, displayRel: string): number {
  return displayRel.toUpperCase() === orderbook.rel.toUpperCase()
    ? orderbook.relDecimals
    : orderbook.baseDecimals;
}

interface RenderOrderRow {
  uuid: string;
  mine: boolean;
  price: number;
  quantity: number;
  total: number;
  depthPct: number;
}

interface DashboardStatusLite {
  referencePricesByPair?: Record<string, number>;
}

function getUsdPrice(ticker: string, refs: Record<string, number>): number {
  const direct = refs[`${ticker.toUpperCase()}/USDT`];
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const reverse = refs[`USDT/${ticker.toUpperCase()}`];
  if (Number.isFinite(reverse) && reverse > 0) return safeDiv(1, reverse);
  if (Number.isFinite(reverse) && reverse === 0) return 0;
  return 0;
}

// ---------------------------------------------------------------------------
// Orderbook section per pair
// ---------------------------------------------------------------------------

function useOrderbook(base: string, rel: string, enabled: boolean) {
  return usePolling<PairOrderbook>(enabled ? `/api/kcb/orderbook?base=${base}&rel=${rel}` : "");
}

function PairSection({
  pair,
  override,
  ltpMap,
  wallets,
  referencePrices,
  onSetLtp,
  onSwap,
  onHide,
  onToggleAllOrders,
  onToggleMilliBase,
  onToggleMilliRel,
}: {
  pair: ResolvedPair;
  override: PairOverride;
  ltpMap: LtpMap;
  wallets: WalletViewEnriched[];
  referencePrices: Record<string, number>;
  onSetLtp: (base: string, rel: string, value: number) => void;
  onSwap: () => void;
  onHide: () => void;
  onToggleAllOrders: () => void;
  onToggleMilliBase: () => void;
  onToggleMilliRel: () => void;
}) {
  const effectiveShowAll = override.showAllOrders;
  const displayBase = override.swapped ? pair.rel : pair.base;
  const displayRel = override.swapped ? pair.base : pair.rel;
  const baseScale = override.milliBase ? 1000 : 1;
  const relScale = override.milliRel ? 1000 : 1;
  const displayBaseTicker = `${override.milliBase ? "m" : ""}${displayBase}`;
  const displayRelTicker = `${override.milliRel ? "m" : ""}${displayRel}`;

  const { data: orderbookData, loading, error } = useOrderbook(
    displayBase,
    displayRel,
    true,
  );

  const asksRaw = orderbookData?.asks ?? [];
  const bidsRaw = orderbookData?.bids ?? [];
  const priceDecimals = orderbookData ? priceDecimalsFromOrderbook(orderbookData, displayRel) : 8;

  const asksMaxTotalRaw = asksRaw.reduce((max, e) => Math.max(max, e.volume * e.price), 0);
  const bidsMaxTotalRaw = bidsRaw.reduce((max, e) => Math.max(max, e.volume * e.price), 0);

  const askRows: RenderOrderRow[] = bidsRaw
    .map((e) => {
      const rawPriceRelPerBase = e.price;
      const priceBasePerRel = rawPriceRelPerBase > 0 ? safeDiv(1, rawPriceRelPerBase) : 0;
      const quantityBase = e.volume;
      const totalRel = quantityBase * rawPriceRelPerBase;
      const displayPrice = priceBasePerRel * safeDiv(baseScale, relScale);
      const displayQuantity = quantityBase * baseScale;
      const displayTotal = totalRel * relScale;
      return {
        uuid: e.uuid,
        mine: e.mine,
        price: displayPrice,
        quantity: displayQuantity,
        total: displayTotal,
        depthPct: bidsMaxTotalRaw > 0 ? (totalRel / bidsMaxTotalRaw) * 100 : 0,
      };
    })
    .sort((a, b) => b.price - a.price);

  const bidRows: RenderOrderRow[] = asksRaw
    .map((e) => {
      const rawPriceRelPerBase = e.price;
      const priceBasePerRel = rawPriceRelPerBase > 0 ? safeDiv(1, rawPriceRelPerBase) : 0;
      const quantityBase = e.volume;
      const totalRel = quantityBase * rawPriceRelPerBase;
      const displayPrice = priceBasePerRel * safeDiv(baseScale, relScale);
      const displayQuantity = quantityBase * baseScale;
      const displayTotal = totalRel * relScale;
      return {
        uuid: e.uuid,
        mine: e.mine,
        price: displayPrice,
        quantity: displayQuantity,
        total: displayTotal,
        depthPct: asksMaxTotalRaw > 0 ? (totalRel / asksMaxTotalRaw) * 100 : 0,
      };
    })
    .sort((a, b) => b.price - a.price);

  const mineAsks = askRows.filter((e) => e.mine);
  const mineBids = bidRows.filter((e) => e.mine);
  const visibleAsks = effectiveShowAll ? askRows : mineAsks;
  const visibleBids = effectiveShowAll ? bidRows : mineBids;

  const totalOrders = askRows.length + bidRows.length;
  const mineOrders = mineAsks.length + mineBids.length;

  const highestBid = bidRows.length > 0 ? bidRows[0].price : 0;
  const lowestAsk = askRows.length > 0 ? askRows[askRows.length - 1].price : 0;
  const spreadAbs = lowestAsk > 0 && highestBid > 0 ? lowestAsk - highestBid : 0;
  const spreadPct = lowestAsk > 0 ? (spreadAbs / lowestAsk) * 100 : 0;

  const baseUsd = getUsdPrice(displayBase, referencePrices);
  const relUsd = getUsdPrice(displayRel, referencePrices);
  const referencePairPrice = baseUsd > 0 && relUsd > 0 ? safeDiv(baseUsd, relUsd) : 0;
  const baseDirectRef = referencePrices[`${displayBase.toUpperCase()}/USDT`];
  const baseReverseRef = referencePrices[`USDT/${displayBase.toUpperCase()}`];
  const relDirectRef = referencePrices[`${displayRel.toUpperCase()}/USDT`];
  const relReverseRef = referencePrices[`USDT/${displayRel.toUpperCase()}`];
  const baseRefText =
    baseDirectRef !== undefined
      ? String(baseDirectRef)
      : baseReverseRef !== undefined
        ? `1/${String(baseReverseRef)}`
        : "null";
  const relRefText =
    relDirectRef !== undefined
      ? String(relDirectRef)
      : relReverseRef !== undefined
        ? `1/${String(relReverseRef)}`
        : "null";

  const ltpKey = pairKey(displayBase, displayRel);
  const ltp = ltpMap[ltpKey] ?? 0;

  // If backend starts returning an explicit LTP later, cache it in both directions.
  useEffect(() => {
    if (!orderbookData) return;
    const maybeLtpRelPerBase = (orderbookData as unknown as { ltp?: number }).ltp;
    if (typeof maybeLtpRelPerBase !== "number" || maybeLtpRelPerBase <= 0) return;
    const ltpBasePerRel = safeDiv(1, maybeLtpRelPerBase);
    onSetLtp(displayBase, displayRel, ltpBasePerRel);
  }, [displayBase, displayRel, onSetLtp, orderbookData]);

  const walletByTicker = new Map(wallets.map((w) => [w.coin.toUpperCase(), w]));
  const baseWallet = walletByTicker.get(displayBase.toUpperCase());
  const relWallet = walletByTicker.get(displayRel.toUpperCase());
  const availableBase = (baseWallet?.spendable ?? baseWallet?.balance ?? 0) * baseScale;
  const availableRel = (relWallet?.spendable ?? relWallet?.balance ?? 0) * relScale;
  const lockedBase = mineAsks.reduce((sum, row) => sum + row.quantity, 0);
  const lockedRel = mineBids.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="card pair-card" style={{ marginBottom: "0.4rem" }}>
      {(pair.baseError || pair.relError) && (
        <p
          className="error"
          style={{ margin: "0 0 0.6rem", fontSize: "0.85em" }}
          title="One or more coins in this pair failed activation"
        >
          ⚠ Activation issue:{" "}
          {[
            pair.baseError ? `${pair.base}: ${pair.baseError}` : null,
            pair.relError ? `${pair.rel}: ${pair.relError}` : null,
          ]
            .filter(Boolean)
            .join(" | ")}
        </p>
      )}
      <div className="pair-header">
        <h3 className="pair-title">
          {displayBase}/{displayRel}
          {orderbookData ? (
            <span
              className="muted pair-title-meta"
              title={`${mineOrders} of your orders / ${totalOrders} total orders`}
            >
              ({mineOrders}/{totalOrders})
            </span>
          ) : null}
          <span
            className="muted pair-title-meta"
            title={`${displayBase}/USDT: ${baseRefText}\n${displayRel}/USDT: ${relRefText}`}
          >
            ref: {referencePairPrice > 0 ? toFixedSafe(referencePairPrice, priceDecimals) : "---"}
          </span>
        </h3>
        <div className="pair-controls">
          <button onClick={onSwap} title="Switch pair direction" style={{ fontSize: "0.8em" }}>
            ⇄ Switch pair
          </button>
          <label className="pair-control-check">
            <input type="checkbox" checked onChange={onHide} />
            Visible
          </label>
          <label className="pair-control-check">
            <input type="checkbox" checked={effectiveShowAll} onChange={onToggleAllOrders} />
            Show all orders
          </label>
          <label className="pair-control-check">
            <input type="checkbox" checked={override.milliBase} onChange={onToggleMilliBase} />
            m{displayBase}
          </label>
          <label className="pair-control-check">
            <input type="checkbox" checked={override.milliRel} onChange={onToggleMilliRel} />
            m{displayRel}
          </label>
        </div>
      </div>

      <div className="pair-balance" style={{ fontFamily: NUMERIC_FONT_STACK, fontVariantNumeric: "tabular-nums" }}>
        <div className="pair-balance-row available">
          <div>AVAILABLE: {toFixedSafe(availableBase, 8)} {displayBaseTicker}</div>
          <div className="right">
            {toFixedSafe(availableRel, 8)} {displayRelTicker}
          </div>
        </div>
        <div className="pair-balance-row locked">
          <div>LOCKED: {toFixedSafe(lockedBase, 8)} {displayBaseTicker}</div>
          <div className="right">
            {toFixedSafe(lockedRel, 8)} {displayRelTicker}
          </div>
        </div>
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
        <div className="pair-orderbook" style={{ fontFamily: NUMERIC_FONT_STACK, fontVariantNumeric: "tabular-nums" }}>
          <div className="orderbook-grid header">
            <div style={{ textAlign: "center" }}>&nbsp;</div>
            <div style={{ textAlign: "right" }}>Price ({displayBaseTicker}/{displayRelTicker})</div>
            <div style={{ textAlign: "right" }}>Quantity ({displayBaseTicker})</div>
            <div style={{ textAlign: "right" }}>Total ({displayRelTicker})</div>
          </div>

          {visibleAsks.map((row) => (
            <div key={`ask-${row.uuid}`} className="orderbook-row ask">
              <div
                className="depth-bar ask"
                style={{ width: `${Math.max(0, Math.min(100, row.depthPct))}%` }}
              />
              <div className="orderbook-grid">
                <div style={{ textAlign: "center", width: "1.4rem" }} title={row.mine ? "Your order" : undefined}>
                  {row.mine ? "●" : "\u00A0"}
                </div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.price, priceDecimals)}</div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.quantity, 2)}</div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.total, 2)}</div>
              </div>
            </div>
          ))}

          <div className="ltp-spread-row">
            <span>
              {ltp === 0
                ? `LTP: (${toFixedSafe(highestBid, priceDecimals)} - ${toFixedSafe(lowestAsk, priceDecimals)})`
                : `LTP: ${toFixedSafe(ltp, priceDecimals)}`}
            </span>
            <span>
              spread: {toFixedSafe(spreadAbs, priceDecimals)} [{toFixedSafe(spreadPct, 2)} %]
            </span>
          </div>

          {visibleBids.map((row) => (
            <div key={`bid-${row.uuid}`} className="orderbook-row bid">
              <div
                className="depth-bar bid"
                style={{ width: `${Math.max(0, Math.min(100, row.depthPct))}%` }}
              />
              <div className="orderbook-grid">
                <div style={{ textAlign: "center", width: "1.4rem" }} title={row.mine ? "Your order" : undefined}>
                  {row.mine ? "●" : "\u00A0"}
                </div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.price, priceDecimals)}</div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.quantity, 2)}</div>
                <div style={{ textAlign: "right" }}>{toFixedSafe(row.total, 2)}</div>
              </div>
            </div>
          ))}
        </div>
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
  const { data: walletsData } = usePolling<WalletViewEnriched[]>("/api/kcb/wallets");
  const { data: statusData } = usePolling<DashboardStatusLite>("/api/kcb/status");

  const [overrides, setOverrides] = useState<Record<string, PairOverride>>(() => loadOverrides());
  const [ltpMap, setLtpMap] = useState<LtpMap>(() => loadLtpMap());

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
      queueMicrotask(() => {
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
      });
    }
  }, [pairs]);

  const getOverride = useCallback(
    (pair: ResolvedPair): PairOverride => {
      const key = pairKey(pair.base, pair.rel);
      const stored = overrides[key];
      const fallback: PairOverride = {
        swapped: false,
        hidden: !pair.show,
        showAllOrders: pair.show_all_orders,
        milliBase: pair.milli_base,
        milliRel: pair.milli_rel,
      };
      if (!stored) return fallback;
      return {
        ...fallback,
        ...stored,
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
      milliBase: pair.milli_base,
      milliRel: pair.milli_rel,
    };
    const updated = { ...overrides, [key]: { ...current, ...patch } };
    setOverrides(updated);
    saveOverrides(updated);
  }

  const setLtp = useCallback((base: string, rel: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const forwardKey = pairKey(base, rel);
    const reverseKey = pairKey(rel, base);
    setLtpMap((prev) => {
      const next: LtpMap = {
        ...prev,
        [forwardKey]: value,
        [reverseKey]: value > 0 ? safeDiv(1, value) : 0,
      };
      saveLtpMap(next);
      return next;
    });
  }, []);

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

      <div className="pair-cards-grid">
        {visiblePairs.map((pair) => {
          const override = getOverride(pair);
          return (
            <PairSection
              key={pairKey(pair.base, pair.rel)}
              pair={pair}
              override={override}
              ltpMap={ltpMap}
              wallets={walletsData ?? []}
              referencePrices={statusData?.referencePricesByPair ?? {}}
              onSetLtp={setLtp}
              onSwap={() =>
                updateOverride(pair, {
                  swapped: !override.swapped,
                  milliBase: override.milliRel,
                  milliRel: override.milliBase,
                })}
              onHide={() => updateOverride(pair, { hidden: true })}
              onToggleAllOrders={() =>
                updateOverride(pair, { showAllOrders: !override.showAllOrders })
              }
              onToggleMilliBase={() =>
                updateOverride(pair, { milliBase: !override.milliBase })
              }
              onToggleMilliRel={() =>
                updateOverride(pair, { milliRel: !override.milliRel })
              }
            />
          );
        })}
      </div>
    </main>
  );
}




