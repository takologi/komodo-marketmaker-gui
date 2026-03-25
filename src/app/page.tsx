"use client";

import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";

interface PairStatusView {
  pair: string;
  hasActiveOrders: boolean;
}

interface DashboardStatusView {
  connectionOk: boolean;
  connectionMessage: string;
  simpleMm: {
    available: boolean;
    status?: {
      healthy: boolean;
      state: string;
      runningSeconds: number;
      strategy: string;
      pair: string;
    };
    message?: string;
  };
  refreshRateMs: number;
  configuredPairs: string[];
  activeOrderCount: number;
  pairsWithActiveOrders: number;
  activeOrderUuids: string[];
  pairStatuses: PairStatusView[];
  version: {
    available: boolean;
    value: string;
    sourceMethod: string;
    message?: string;
  };
}

export default function HomePage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<DashboardStatusView>(
    "/api/kdf/status",
  );

  return (
    <main className="page">
      <Nav />

      <section className="card">
        <h2>Dashboard summary</h2>
        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && !data ? <EmptyState message="No dashboard summary available." /> : null}

        {data ? (
          <div className="summary-grid">
            <article className="metric-card">
              <h3>Connectivity</h3>
              <p className="status">
                <span className={`dot ${data.connectionOk ? "ok" : "bad"}`} />
                {data.connectionOk ? "Connected" : "Disconnected"}
              </p>
              <p className="muted">{data.connectionMessage}</p>
            </article>
            <article className="metric-card">
              <h3>Refresh rate</h3>
              <p>{data.refreshRateMs} ms</p>
              <p className="muted">Client polling interval</p>
            </article>
            <article className="metric-card">
              <h3>Configured pairs</h3>
              <p>{data.configuredPairs.length}</p>
              <p className="muted">Pairs visible from MM status</p>
            </article>
            <article className="metric-card">
              <h3>Active orders</h3>
              <p>{data.activeOrderCount}</p>
              <p className="muted">Pairs with orders: {data.pairsWithActiveOrders}</p>
            </article>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Simple MM status</h2>
        {data ? (
          <div className="grid-2">
            <div>
              <p>
                <span className="status">
                  <span
                    className={`dot ${
                      data.simpleMm.available && data.simpleMm.status?.healthy ? "ok" : "bad"
                    }`}
                  />
                  {data.simpleMm.available
                    ? data.simpleMm.status?.healthy
                      ? "Healthy"
                      : "Unhealthy"
                    : "Unavailable"}
                </span>
              </p>
              <p className="muted" style={{ marginTop: "0.45rem" }}>
                State: {data.simpleMm.status?.state ?? "unavailable"}
              </p>
              {!data.simpleMm.available && data.simpleMm.message ? (
                <p className="muted" style={{ marginTop: "0.45rem" }}>
                  {data.simpleMm.message}
                </p>
              ) : null}
            </div>
            <div>
              <p>Pair: {data.simpleMm.status?.pair ?? "not configured"}</p>
              <p>Strategy: {data.simpleMm.status?.strategy ?? "simple-mm"}</p>
              <p>Uptime: {data.simpleMm.status?.runningSeconds ?? 0}s</p>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Pairs and order UUIDs</h2>
        {!data ? <p className="muted">Waiting for dashboard payload…</p> : null}
        {data && data.pairStatuses.length === 0 ? (
          <EmptyState message="No configured pairs were returned by status RPC." />
        ) : null}
        {data && data.pairStatuses.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Active order presence</th>
              </tr>
            </thead>
            <tbody>
              {data.pairStatuses.map((pair) => (
                <tr key={pair.pair}>
                  <td>{pair.pair}</td>
                  <td>{pair.hasActiveOrders ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div style={{ marginTop: "0.75rem" }}>
          <h3 style={{ marginBottom: "0.35rem" }}>Active order UUIDs</h3>
          {!data || data.activeOrderUuids.length === 0 ? (
            <p className="muted">No active order UUIDs available.</p>
          ) : (
            <ul className="uuid-list">
              {data.activeOrderUuids.map((uuid) => (
                <li key={uuid}>
                  <code>{uuid}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Version / health-like probe</h2>
        {!data ? <p className="muted">Waiting for probe result…</p> : null}
        {data ? (
          <div>
            <p>
              <strong>Available:</strong> {data.version.available ? "yes" : "no"}
            </p>
            <p>
              <strong>Source method:</strong> {data.version.sourceMethod}
            </p>
            <p>
              <strong>Value:</strong> {data.version.value}
            </p>
            {data.version.message ? <p className="muted">{data.version.message}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Notes</h2>
        <p className="muted">
          Browser traffic is restricted to internal <code>/api/*</code> endpoints. KDF/MM2
          credentials remain server-side only.
        </p>
        <div className="inline-meta" style={{ marginTop: "0.6rem" }}>
          <span>Last fetch: {fetchedAt ?? "never"}</span>
          <button onClick={() => void refresh()}>Refresh now</button>
        </div>
      </section>
    </main>
  );
}
