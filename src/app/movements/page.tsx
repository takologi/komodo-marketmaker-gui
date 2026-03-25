"use client";

import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { MovementView } from "@/lib/kdf/adapters/movements";

interface MovementsData {
  rows: MovementView[];
  integration: {
    available: boolean;
    method?: string;
    message?: string;
  };
}

export default function MovementsPage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<MovementsData>(
    "/api/kdf/movements",
  );

  return (
    <main className="page">
      <Nav />
      <section className="card">
        <h2>Recent movements</h2>
        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && data && !data.integration.available ? (
          <EmptyState
            message={
              data.integration.message ||
              "Movements are not yet implemented from backend source in this deployment."
            }
          />
        ) : null}
        {!loading && !error && data && data.integration.available && data.rows.length === 0 ? (
          <EmptyState message="No recent swaps/movements available." />
        ) : null}
        {data && data.integration.available && data.rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Pair</th>
                <th>Type</th>
                <th>Status</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.id}</td>
                  <td>{movement.pair}</td>
                  <td>{movement.side}</td>
                  <td>{movement.status}</td>
                  <td>{movement.startedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {data ? (
          <p className="muted" style={{ marginTop: "0.6rem" }}>
            Integration method: {data.integration.method ?? "none"}
          </p>
        ) : null}
        <div className="inline-meta" style={{ marginTop: "0.7rem" }}>
          <span>Last fetch: {fetchedAt ?? "never"}</span>
          <button onClick={() => void refresh()}>Refresh now</button>
        </div>
      </section>
    </main>
  );
}
