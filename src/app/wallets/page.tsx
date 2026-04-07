"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { WalletViewEnriched } from "@/lib/kdf/adapters/wallets";

function formatFetchTimestamp(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}:${ss}`;
}

function formatTimestamp(ts?: number): string {
  if (!Number.isFinite(ts ?? Number.NaN) || !ts) return "n/a";
  const millis = ts < 10_000_000_000 ? ts * 1000 : ts;
  return new Date(millis).toLocaleString();
}

function formatSignedAmount(value?: number): string {
  if (!Number.isFinite(value ?? Number.NaN) || value === undefined) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(8)}`;
}

function txDirectionBadge(direction?: "sent" | "received" | "self" | "unknown") {
  switch (direction) {
    case "received":
      return { icon: "⬇", label: "received" };
    case "sent":
      return { icon: "⬆", label: "sent" };
    case "self":
      return { icon: "⇄", label: "self transfer" };
    default:
      return { icon: "•", label: "unknown" };
  }
}

function AddressList({
  title,
  addresses,
  explorerUrls,
}: {
  title: string;
  addresses?: string[];
  explorerUrls?: string[];
}) {
  const rows = addresses ?? [];
  if (rows.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: "0.1rem" }}>
      <div>{title}:</div>
      <div style={{ display: "grid", gap: "0.2rem", paddingLeft: "0.5rem" }}>
        {rows.map((address, index) => {
          const href = explorerUrls?.[index];
          return href ? (
            <a
              key={`${title}-${address}-${index}`}
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "underline", wordBreak: "break-all" }}
            >
              <code>{address}</code>
            </a>
          ) : (
            <code key={`${title}-${address}-${index}`} style={{ wordBreak: "break-all" }}>
              {address}
            </code>
          );
        })}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy address to clipboard"
      style={{ fontSize: "0.8em", padding: "0.2rem 0.5rem" }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function WalletCard({ wallet }: { wallet: WalletViewEnriched }) {
  const [expanded, setExpanded] = useState(false);
  const sourceEntries = Object.entries(wallet.referencePricesBySource ?? {})
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <div
      className="card"
      style={{
        marginBottom: "0.7rem",
        padding: "0.8rem 1rem",
        opacity: wallet.activated ? 1 : 0.75,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.7rem", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "1.05em" }}>{wallet.coin}</strong>
        {wallet.activated ? (
          <span className="muted" style={{ fontSize: "0.9em" }}>
            Balance: {wallet.balance?.toFixed(8) ?? "0.00000000"}{" "}
            <span title="Spendable">(spendable: {wallet.spendable?.toFixed(8) ?? "0.00000000"})</span>
          </span>
        ) : (
          <span className="muted" style={{ fontSize: "0.85em" }}>
            not activated
          </span>
        )}
      </div>

      {wallet.activated && wallet.address ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginTop: "0.4rem",
            flexWrap: "wrap",
          }}
        >
          <code style={{ fontSize: "0.85em", wordBreak: "break-all" }}>{wallet.address}</code>
          <CopyButton text={wallet.address} />
        </div>
      ) : null}

      {wallet.activated ? (
        <p className="muted" style={{ marginTop: "0.35rem", fontSize: "0.82em" }}>
          unspendable: {wallet.unspendable?.toFixed(8) ?? "0.00000000"}
          {wallet.requiredConfirmations !== undefined
            ? ` • required confirmations: ${wallet.requiredConfirmations}`
            : ""}
        </p>
      ) : null}

      {sourceEntries.length > 0 ? (
        <div className="muted" style={{ marginTop: "0.25rem", fontSize: "0.82em", display: "grid", gap: "0.12rem" }}>
          <div>
            reference prices ({wallet.referenceQuoteTicker ?? "USDT"})
          </div>
          <div style={{ display: "grid", gap: "0.08rem", paddingLeft: "0.45rem" }}>
            {sourceEntries.map(([sourceId, value]) => (
              <div key={`${wallet.coin}-${sourceId}`}>
                {sourceId}: {value.toFixed(8)} ({formatFetchTimestamp(wallet.referencePriceFetchedAtBySource?.[sourceId])})
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {wallet.activated ? (
        <div style={{ marginTop: "0.55rem" }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ fontSize: "0.82em", padding: "0.3rem 0.55rem" }}
          >
            {expanded ? "▾ Hide tx history" : "▸ Show tx history"}
          </button>

          {expanded ? (
            <div style={{ marginTop: "0.45rem" }}>
              {!wallet.txHistory?.available ? (
                <p className="muted" style={{ fontSize: "0.82em" }}>
                  {wallet.txHistory?.message ?? "Transaction history is not available for this wallet."}
                </p>
              ) : wallet.txHistory.rows.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.82em" }}>
                  No transactions found.
                </p>
              ) : (
                <div style={{ display: "grid", gap: "0.42rem" }}>
                  {wallet.txHistory.rows.map((tx) => (
                    <div
                      key={tx.txid}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        padding: "0.45rem 0.55rem",
                        background: "#0f1830",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap" }}>
                        <strong style={{ fontSize: "0.82em" }}>
                          {txDirectionBadge(tx.direction).icon} {txDirectionBadge(tx.direction).label}
                        </strong>
                        <span style={{ fontSize: "0.82em" }}>
                          amount: {formatSignedAmount(tx.amount)} {wallet.coin}
                        </span>
                      </div>

                      <div className="muted" style={{ marginTop: "0.26rem", fontSize: "0.8em", display: "grid", gap: "0.15rem" }}>
                        <div>
                          txid:{" "}
                          {tx.explorerUrl ? (
                            <a href={tx.explorerUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                              <code style={{ wordBreak: "break-all" }}>{tx.txid}</code>
                            </a>
                          ) : (
                            <code style={{ wordBreak: "break-all" }}>{tx.txid}</code>
                          )}
                        </div>
                        <div>time: {formatTimestamp(tx.timestamp)}</div>
                        <div>
                          confirmations: {tx.confirmations ?? "n/a"}
                          {tx.blockHeight !== undefined ? ` • height: ${tx.blockHeight}` : ""}
                        </div>
                        <AddressList
                          title="from"
                          addresses={tx.fromAddresses}
                          explorerUrls={tx.fromExplorerUrls}
                        />
                        <AddressList
                          title="to"
                          addresses={tx.toAddresses}
                          explorerUrls={tx.toExplorerUrls}
                        />
                        {tx.blockHash ? <div>block hash: <code>{tx.blockHash}</code></div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!wallet.activated && wallet.error ? (
        <p className="error" style={{ margin: "0.4rem 0 0", fontSize: "0.85em" }}>
          {wallet.error}
        </p>
      ) : null}
    </div>
  );
}

export default function WalletsPage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<WalletViewEnriched[]>("/api/kcb/wallets");

  return (
    <main className="page">
      <Nav />
      <section className="card">
        <h2>Wallets</h2>
        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && (!data || data.length === 0) ? (
          <EmptyState message="No coins are configured in bootstrap." />
        ) : null}
        {data && data.length > 0 ? (
          <div style={{ marginTop: "0.5rem" }}>
            {data.map((wallet) => (
              <WalletCard key={wallet.coin} wallet={wallet} />
            ))}
          </div>
        ) : null}
        <div className="inline-meta" style={{ marginTop: "0.7rem" }}>
          <span>Last fetch: {fetchedAt ?? "never"}</span>
          <button onClick={() => void refresh()}>Refresh now</button>
        </div>
      </section>
    </main>
  );
}
