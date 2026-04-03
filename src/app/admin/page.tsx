"use client";

import { useCallback, useEffect, useState } from "react";

import { Nav } from "@/components/nav";
import { usePolling } from "@/components/use-polling";
import { GuiPairPolicy, ResolvedPair } from "@/lib/kcb/types";

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

      <TradingPairsAdmin token={token} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Trading pairs admin section
// ---------------------------------------------------------------------------

interface PairRow {
  base: string;
  rel: string;
  swapped: boolean;
  show: boolean;
  showAllOrders: boolean;
}

function pairKey(base: string, rel: string) {
  return `${base}/${rel}`;
}

function TradingPairsAdmin({ token }: { token: string }) {
  const { data: pairs } = usePolling<ResolvedPair[]>("/api/kcb/pairs");
  const [rows, setRows] = useState<PairRow[]>([]);
  const [saveStatus, setSaveStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // When true, incoming server polls won't overwrite in-progress user edits.
  const [isDirty, setIsDirty] = useState(false);

  function readLsOverrides(): Record<string, { hidden?: boolean; showAllOrders?: boolean }> {
    try {
      const raw = localStorage.getItem("kcb:pair-overrides");
      return raw ? (JSON.parse(raw) as Record<string, { hidden?: boolean; showAllOrders?: boolean }>) : {};
    } catch {
      return {};
    }
  }

  // Sync rows from server whenever there are no unsaved edits.
  useEffect(() => {
    if (!pairs || pairs.length === 0) return;
    if (isDirty) return;

    const lsOverrides = readLsOverrides();
    setRows(
      pairs.map((p) => {
        const key = `${p.base}/${p.rel}`;
        const ls = lsOverrides[key];
        return {
          base: p.base,
          rel: p.rel,
          swapped: false,
          show: ls?.hidden !== undefined ? !ls.hidden : p.show,
          showAllOrders: ls?.showAllOrders !== undefined ? ls.showAllOrders : p.show_all_orders,
        };
      }),
    );
  }, [pairs, isDirty]);

  /**
   * Persist a rows snapshot to both localStorage and the gui-policy API.
   * Called immediately after every user interaction (no Save button needed).
   */
  async function saveRows(nextRows: PairRow[]) {
    // Always sync localStorage, regardless of whether the token is set.
    try {
      const raw = localStorage.getItem("kcb:pair-overrides");
      const lsOverrides: Record<string, { swapped?: boolean; hidden?: boolean; showAllOrders?: boolean }> =
        raw ? (JSON.parse(raw) as Record<string, { swapped?: boolean; hidden?: boolean; showAllOrders?: boolean }>) : {};
      for (const r of nextRows) {
        const key = `${r.base}/${r.rel}`;
        lsOverrides[key] = { ...lsOverrides[key], hidden: !r.show, showAllOrders: r.showAllOrders };
      }
      localStorage.setItem("kcb:pair-overrides", JSON.stringify(lsOverrides));
    } catch {
      // localStorage unavailable — not critical.
    }

    if (!token) {
      setSaveStatus({ ok: false, message: "Enter admin token above to persist to gui-policy.json." });
      return;
    }

    setSaving(true);
    setSaveStatus(null);

    const tradingPairs: GuiPairPolicy[] = nextRows.map((r) => ({
      base: r.swapped ? r.rel : r.base,
      rel: r.swapped ? r.base : r.rel,
      show: r.show,
      show_all_orders: r.showAllOrders,
    }));

    try {
      const res = await fetch("/api/kcb/gui-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ trading_pairs: tradingPairs }),
      });
      const json = (await res.json()) as { ok: boolean; message?: string };
      setSaveStatus({ ok: json.ok, message: json.ok ? "Applied." : (json.message ?? "Save failed.") });
      if (json.ok) {
        setIsDirty(false);
      }
    } catch {
      setSaveStatus({ ok: false, message: "Failed to contact gui-policy endpoint." });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Apply a change to one row immediately: update state, sync localStorage,
   * and save to the API if a token is available.
   */
  function patchRow(base: string, rel: string, patch: Partial<PairRow>) {
    const nextRows = rows.map((r) => (r.base === base && r.rel === rel ? { ...r, ...patch } : r));
    setRows(nextRows);
    setIsDirty(true);
    void saveRows(nextRows);
  }

  if (!pairs || pairs.length === 0) {
    return (
      <section className="card">
        <h2>Trading pairs</h2>
        <p className="muted">No trading pairs resolved from bootstrap config.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Trading pairs</h2>
      <p className="muted" style={{ marginBottom: "0.6rem" }}>
        Changes apply immediately.{" "}
        {token
          ? "Settings are persisted to gui-policy.json."
          : "Enter admin token above to also persist to gui-policy.json."}
      </p>
      <table className="table">
        <thead>
          <tr>
            <th>Pair</th>
            <th>Visible</th>
            <th>Show all orders</th>
            <th>Swap sides</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const displayBase = row.swapped ? row.rel : row.base;
            const displayRel = row.swapped ? row.base : row.rel;
            return (
              <tr key={pairKey(row.base, row.rel)}>
                <td>{displayBase}/{displayRel}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={row.show}
                    onChange={() => patchRow(row.base, row.rel, { show: !row.show })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={row.showAllOrders}
                    onChange={() => patchRow(row.base, row.rel, { showAllOrders: !row.showAllOrders })}
                  />
                </td>
                <td>
                  <button
                    style={{ fontSize: "0.8em" }}
                    onClick={() => patchRow(row.base, row.rel, { swapped: !row.swapped })}
                  >
                    ⇄ {row.swapped ? `${row.rel}/${row.base}` : `${row.base}/${row.rel}`}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {saving ? (
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>Saving…</p>
      ) : saveStatus ? (
        <p
          className={saveStatus.ok ? "ok" : "muted"}
          style={{ marginTop: "0.5rem", fontSize: "0.85em" }}
        >
          {saveStatus.message}
        </p>
      ) : null}
    </section>
  );
}
