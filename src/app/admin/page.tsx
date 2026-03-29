"use client";

import { useCallback, useEffect, useState } from "react";

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
    logWindowEnabled: boolean;
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
  const [levelsReady, setLevelsReady] = useState(false);
  const [logWindowEnabled, setLogWindowEnabled] = useState(false);

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

  const loadRuntimeLevels = useCallback(async () => {
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
      setLogWindowEnabled(Boolean(json.data.logWindowEnabled));
      setLevelsResult("Runtime levels synced");
      setLevelsReady(true);
    } catch {
      setLevelsResult("Failed to contact runtime level endpoint");
    } finally {
      setLevelsBusy(false);
    }
  }, [token]);

  async function saveRuntimeLevels(
    nextMessageLevel: DebugSeverity,
    nextLogLevel: DebugSeverity,
    nextLogWindowEnabled: boolean,
  ) {
    if (!token) {
      setLevelsResult("Admin token required to save runtime levels");
      return;
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
          messageLevel: nextMessageLevel,
          logLevel: nextLogLevel,
          logWindowEnabled: nextLogWindowEnabled,
        }),
      });

      const json = (await res.json()) as DebugLevelsResponse;
      if (json.ok && json.data) {
        setMessageLevel(json.data.messageLevel);
        setLogLevel(json.data.logLevel);
        setLogWindowEnabled(Boolean(json.data.logWindowEnabled));
      }
      setLevelsResult(json.message || "Runtime levels updated");
    } catch {
      setLevelsResult("Failed to save runtime levels");
    } finally {
      setLevelsBusy(false);
    }
  }

  const verbosityRank: Record<DebugSeverity, number> = {
    critical: 0,
    error: 1,
    warning: 2,
    info: 3,
    debug: 4,
    trace: 5,
  };

  function shouldConfirmIncrease(oldLevel: DebugSeverity, newLevel: DebugSeverity): boolean {
    const moreDetailed = verbosityRank[newLevel] > verbosityRank[oldLevel];
    const belowInfo = newLevel === "debug" || newLevel === "trace";
    return moreDetailed && belowInfo;
  }

  async function onMessageLevelChange(next: DebugSeverity) {
    const previous = messageLevel;

    if (shouldConfirmIncrease(previous, next)) {
      const confirmed = window.confirm(
        "Are you sure? DEBUG_MESSAGE_LEVEL set to debug/trace can generate a high number of popup writes.",
      );
      if (!confirmed) {
        return;
      }
    }

    setMessageLevel(next);
    await saveRuntimeLevels(next, logLevel, logWindowEnabled);
  }

  async function onLogLevelChange(next: DebugSeverity) {
    const previous = logLevel;

    if (shouldConfirmIncrease(previous, next)) {
      const confirmed = window.confirm(
        "Are you sure? DEBUG_LOG_LEVEL set to debug/trace can generate a high number of log writes.",
      );
      if (!confirmed) {
        return;
      }
    }

    setLogLevel(next);
    await saveRuntimeLevels(messageLevel, next, logWindowEnabled);
  }

  async function onLogWindowEnabledChange(next: boolean) {
    setLogWindowEnabled(next);
    await saveRuntimeLevels(messageLevel, logLevel, next);
  }

  useEffect(() => {
    if (!token) {
      setLevelsReady(false);
      return;
    }

    if (!levelsReady) {
      void loadRuntimeLevels();
    }
  }, [token, levelsReady, loadRuntimeLevels]);

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
              onChange={(e) => {
                void onMessageLevelChange(e.target.value as DebugSeverity);
              }}
              style={{ marginTop: "0.3rem", width: "100%" }}
              disabled={levelsBusy || !token}
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
              onChange={(e) => {
                void onLogLevelChange(e.target.value as DebugSeverity);
              }}
              style={{ marginTop: "0.3rem", width: "100%" }}
              disabled={levelsBusy || !token}
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>

          {!token ? <p className="muted">Set admin token above to enable live runtime controls.</p> : null}

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={logWindowEnabled}
              onChange={(e) => {
                void onLogWindowEnabledChange(e.target.checked);
              }}
              disabled={levelsBusy || !token}
              style={{ width: "auto" }}
            />
            Enable on-screen log window
          </label>
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
