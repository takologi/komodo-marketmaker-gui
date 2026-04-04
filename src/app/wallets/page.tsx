"use client";

import { useState } from "react";
import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { WalletViewEnriched } from "@/lib/kdf/adapters/wallets";

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
