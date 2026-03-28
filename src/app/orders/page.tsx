"use client";

import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { OrderView } from "@/lib/kdf/adapters/orders";

export default function OrdersPage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<OrderView[]>("/api/kcb/orders");

  return (
    <main className="page">
      <Nav />
      <section className="card">
        <h2>Open orders</h2>
        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && (!data || data.length === 0) ? (
          <EmptyState message="No open orders detected." />
        ) : null}
        {data && data.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Id</th>
                <th>Pair</th>
                <th>Side</th>
                <th>Price</th>
                <th>Volume</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>
                    {order.base}/{order.rel}
                  </td>
                  <td>{order.side}</td>
                  <td>{order.price}</td>
                  <td>{order.volume}</td>
                  <td>{order.createdAt}</td>
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
