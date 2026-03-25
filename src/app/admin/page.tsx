"use client";

import { useState } from "react";

import { Nav } from "@/components/nav";

interface RestartResponse {
  ok: boolean;
  message: string;
  output?: string;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestartResponse | null>(null);

  async function onRestartClick() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/restart", {
        method: "POST",
        headers: {
          "x-admin-token": token,
        },
      });

      const json = (await res.json()) as RestartResponse;
      setResult(json);
    } catch {
      setResult({ ok: false, message: "Failed to contact restart endpoint" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <Nav />
      <section className="card">
        <h2>Admin controls</h2>
        <p className="muted" style={{ marginBottom: "0.6rem" }}>
          Restart action is server-side only and requires a token that matches
          <code> MM2_RESTART_TOKEN</code>.
        </p>
        <p className="muted" style={{ marginBottom: "0.6rem" }}>
          Restart execution is intentionally narrow: <code>systemctl</code> mode for one specific
          service, or one fixed wrapper script path.
        </p>

        <div className="controls">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter admin restart token"
          />
          <button onClick={() => void onRestartClick()} disabled={busy || !token}>
            {busy ? "Submitting…" : "Restart market maker"}
          </button>
        </div>

        {result ? (
          <div style={{ marginTop: "0.8rem" }}>
            <p className={result.ok ? "ok" : "error"}>{result.message}</p>
            {result.output ? <pre style={{ marginTop: "0.5rem" }}>{result.output}</pre> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
