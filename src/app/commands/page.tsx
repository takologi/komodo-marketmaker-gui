"use client";

import { useState } from "react";

import { Nav } from "@/components/nav";
import { EmptyState, ErrorState, LoadingState } from "@/components/states";
import { usePolling } from "@/components/use-polling";
import { KcbCommandRecord } from "@/lib/kcb/types";

interface ApiResponse {
  ok: boolean;
  message?: string;
}

export default function CommandsPage() {
  const { data, loading, error, fetchedAt, refresh } = usePolling<KcbCommandRecord[]>(
    "/api/kcb/commands",
  );
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "normal">("all");

  const filtered = (data || []).filter((command) =>
    priorityFilter === "all" ? true : command.priority === priorityFilter,
  );

  async function queueCommand(type: "apply_bootstrap" | "refresh_coins") {
    if (!token) {
      setResult("Admin token is required.");
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/kcb/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ type, priority: "normal" }),
      });

      const json = (await res.json()) as ApiResponse;
      if (!json.ok) {
        setResult(json.message || "Failed to queue command");
        return;
      }

      setResult(`${type} command queued.`);
      await refresh();
    } catch {
      setResult("Failed to contact command endpoint.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <Nav />

      <section className="card">
        <h2>KCB command center</h2>
        <p className="muted" style={{ marginBottom: "0.7rem" }}>
          This page shows queued/running/completed KCB commands and lets you trigger selected
          operations through the command queue.
        </p>

        <div className="controls" style={{ marginBottom: "0.6rem" }}>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter admin token"
          />
          <button
            disabled={submitting || !token}
            onClick={() => {
              void queueCommand("refresh_coins");
            }}
          >
            Queue coin refresh
          </button>
          <button
            disabled={submitting || !token}
            onClick={() => {
              void queueCommand("apply_bootstrap");
            }}
          >
            Queue bootstrap apply
          </button>
        </div>

        {result ? <p className="muted">{result}</p> : null}
      </section>

      <section className="card">
        <h2>Command history</h2>
        <div className="controls" style={{ marginBottom: "0.7rem" }}>
          <label>
            Priority filter
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as "all" | "high" | "normal")}
              style={{ marginTop: "0.3rem", width: "100%" }}
            >
              <option value="all">all</option>
              <option value="high">high</option>
              <option value="normal">normal</option>
            </select>
          </label>
          <p className="muted" style={{ alignSelf: "end" }}>
            Showing {filtered.length} / {(data || []).length}
          </p>
        </div>

        {loading ? <LoadingState /> : null}
        {!loading && error ? <ErrorState message={error} /> : null}
        {!loading && !error && (!data || data.length === 0) ? (
          <EmptyState message="No KCB commands in retention window." />
        ) : null}
        {!loading && !error && data && data.length > 0 && filtered.length === 0 ? (
          <EmptyState message="No commands match the selected priority filter." />
        ) : null}

        {filtered.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Id</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Finished</th>
                <th>Summary</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((command) => (
                <tr key={command.id}>
                  <td>{command.created_at}</td>
                  <td>
                    <code>{command.id}</code>
                  </td>
                  <td>{command.type}</td>
                  <td>{command.priority}</td>
                  <td>{command.status}</td>
                  <td>{command.finished_at ?? "-"}</td>
                  <td>
                    {command.summary ? (
                      <code>{JSON.stringify(command.summary).slice(0, 160)}</code>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{command.error_message ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="inline-meta" style={{ marginTop: "0.7rem" }}>
          <span>Last fetch: {fetchedAt ?? "never"}</span>
          <button
            onClick={() => {
              void refresh();
            }}
          >
            Refresh now
          </button>
        </div>
      </section>
    </main>
  );
}
