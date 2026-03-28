"use client";

import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { WalletView } from "@/lib/kdf/adapters/wallets";

export default function WalletsPage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<WalletView[]>("/api/kcb/wallets");

  return (
    <main className="page">
      <Nav />
      <section className="card">
        <h2>Wallets</h2>
        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && (!data || data.length === 0) ? (
          <EmptyState message="No enabled wallets were returned." />
        ) : null}
        {data && data.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Coin</th>
                <th>Address</th>
                <th>Balance</th>
                <th>Spendable</th>
              </tr>
            </thead>
            <tbody>
              {data.map((wallet) => (
                <tr key={`${wallet.coin}-${wallet.address}`}>
                  <td>{wallet.coin}</td>
                  <td>{wallet.address}</td>
                  <td>{wallet.balance}</td>
                  <td>{wallet.spendable}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="inline-meta" style={{ marginTop: "0.7rem" }}>
          <span>Last fetch: {fetchedAt ?? "never"}</span>
          <button onClick={() => void refresh()}>Refresh now</button>
        </div>
      </section>
    </main>
  );
}
