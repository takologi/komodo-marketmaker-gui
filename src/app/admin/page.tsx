"use client";

import { useState } from "react";

import { Nav } from "@/components/nav";

const SEVERITIES = ["critical", "error", "warning", "info", "debug", "trace"] as const;

type DebugSeverity = (typeof SEVERITIES)[number];

interface RestartResponse {
  ok: boolean;
  message: string;
  output?: string;
}

interface DebugLevelsResponse {
  ok: boolean;
  message: string;
  data?: {
    messageLevel: DebugSeverity;
    logLevel: DebugSeverity;
    allowed: readonly DebugSeverity[];
  };
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestartResponse | null>(null);
  const [messageLevel, setMessageLevel] = useState<DebugSeverity>("warning");
  const [logLevel, setLogLevel] = useState<DebugSeverity>("debug");
  const [levelsBusy, setLevelsBusy] = useState(false);
  const [levelsResult, setLevelsResult] = useState<string | null>(null);

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

  async function loadRuntimeLevels() {
    if (!token) {
      setLevelsResult("Admin token required to load runtime levels");
      return;
    }

    setLevelsBusy(true);
    try {
      const res = await fetch("/api/admin/debug-levels", {
        headers: {
          "x-admin-token": token,
        },
      });

      const json = (await res.json()) as DebugLevelsResponse;
      if (!json.ok || !json.data) {
        setLevelsResult(json.message || "Failed to load runtime levels");
        return;
      }

      setMessageLevel(json.data.messageLevel);
      setLogLevel(json.data.logLevel);
      setLevelsResult("Runtime levels loaded");
    } catch {
      setLevelsResult("Failed to contact runtime level endpoint");
    } finally {
      setLevelsBusy(false);
    }
  }

  async function saveRuntimeLevels() {
    if (!token) {
      setLevelsResult("Admin token required to save runtime levels");
      return;
    }

    const selectedHighVerbosity =
      [messageLevel, logLevel].includes("debug") || [messageLevel, logLevel].includes("trace");

    if (selectedHighVerbosity) {
      const confirmed = window.confirm(
        "Are you sure? Setting DEBUG_MESSAGE_LEVEL or DEBUG_LOG_LEVEL to debug/trace can generate a high number of popup and/or log writes.",
      );
      if (!confirmed) {
        setLevelsResult("Runtime level change cancelled");
        return;
      }
    }

    setLevelsBusy(true);
    try {
      const res = await fetch("/api/admin/debug-levels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({
          messageLevel,
          logLevel,
        }),
      });

      const json = (await res.json()) as DebugLevelsResponse;
      setLevelsResult(json.message || "Runtime levels updated");
    } catch {
      setLevelsResult("Failed to save runtime levels");
    } finally {
      setLevelsBusy(false);
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

      <section className="card">
        <h2>Runtime debug filter levels</h2>
        <p className="muted" style={{ marginBottom: "0.6rem" }}>
          These values apply instantly in runtime for popup/log filtering and do not modify
          <code> .env.local</code>.
        </p>

        <div className="controls">
          <label>
            DEBUG_MESSAGE_LEVEL
            <select
              value={messageLevel}
              onChange={(e) => setMessageLevel(e.target.value as DebugSeverity)}
              style={{ marginTop: "0.3rem", width: "100%" }}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>

          <label>
            DEBUG_LOG_LEVEL
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value as DebugSeverity)}
              style={{ marginTop: "0.3rem", width: "100%" }}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>

          <button onClick={() => void loadRuntimeLevels()} disabled={levelsBusy || !token}>
            {levelsBusy ? "Loading…" : "Load current runtime levels"}
          </button>

          <button onClick={() => void saveRuntimeLevels()} disabled={levelsBusy || !token}>
            {levelsBusy ? "Applying…" : "Apply runtime levels now"}
          </button>
        </div>

        {levelsResult ? (
          <p className="muted" style={{ marginTop: "0.8rem" }}>
            {levelsResult}
          </p>
        ) : null}
      </section>
    </main>
  );
}
