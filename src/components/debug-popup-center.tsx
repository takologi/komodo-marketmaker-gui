"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DebugSeverity = "critical" | "error" | "warning" | "info" | "debug" | "trace";

interface DebugMessage {
  id: string;
  timestamp: string;
  severity: DebugSeverity;
  title: string;
  body: string;
}

interface DebugMessageApiResponse {
  ok: boolean;
  timeoutSeconds?: number;
  data?: DebugMessage[];
}

interface PopupMessage extends DebugMessage {
  phase: "entering" | "visible" | "closing";
}

const POLL_MS = 1500;
const TRANSITION_MS = 500;

export function DebugPopupCenter() {
  const [messages, setMessages] = useState<PopupMessage[]>([]);
  const [timeoutSeconds, setTimeoutSeconds] = useState(8);

  const removeTimersRef = useRef<Map<string, number>>(new Map());
  const autoCloseTimersRef = useRef<Map<string, number>>(new Map());

  const closeMessage = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id && m.phase !== "closing" ? { ...m, phase: "closing" } : m)),
    );

    const existing = removeTimersRef.current.get(id);
    if (existing) {
      clearTimeout(existing);
    }

    const removeTimer = window.setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      removeTimersRef.current.delete(id);

      const autoClose = autoCloseTimersRef.current.get(id);
      if (autoClose) {
        clearTimeout(autoClose);
        autoCloseTimersRef.current.delete(id);
      }
    }, TRANSITION_MS);

    removeTimersRef.current.set(id, removeTimer);
  }, []);

  useEffect(() => {
    let active = true;
    const removeTimers = removeTimersRef.current;
    const autoCloseTimers = autoCloseTimersRef.current;

    const fetchMessages = async () => {
      try {
        const response = await fetch("/api/debug/messages?limit=50", { cache: "no-store" });
        const payload = (await response.json()) as DebugMessageApiResponse;
        if (typeof payload.timeoutSeconds === "number") {
          setTimeoutSeconds(payload.timeoutSeconds);
        }

        if (!active || !payload.ok || !payload.data || payload.data.length === 0) {
          return;
        }

        for (const msg of payload.data) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            const next = [...prev, { ...msg, phase: "entering" as const }];
            return next.slice(-40);
          });

          window.setTimeout(() => {
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.id && m.phase === "entering" ? { ...m, phase: "visible" } : m)),
            );
          }, 20);

          if (timeoutSeconds > 0) {
            const autoTimer = window.setTimeout(() => {
              closeMessage(msg.id);
            }, timeoutSeconds * 1000);
            autoCloseTimersRef.current.set(msg.id, autoTimer);
          }
        }
      } catch {
        // Silent by design; this is best-effort diagnostics UI.
      }
    };

    void fetchMessages();
    const timer = setInterval(() => void fetchMessages(), POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);

      for (const t of removeTimers.values()) {
        clearTimeout(t);
      }
      for (const t of autoCloseTimers.values()) {
        clearTimeout(t);
      }
      removeTimers.clear();
      autoCloseTimers.clear();
    };
  }, [closeMessage, timeoutSeconds]);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <aside className="debug-popups" aria-live="polite" aria-label="Debug popups">
      {ordered.map((msg) => (
        <article
          key={msg.id}
          className={`debug-popup severity-${msg.severity} phase-${msg.phase}`}
        >
          <header>
            <strong>{msg.title}</strong>
            <button
              type="button"
              onClick={() => closeMessage(msg.id)}
              aria-label="Close popup"
            >
              ×
            </button>
          </header>
          <p className="debug-popup-meta">
            <span>{msg.timestamp}</span>
            <span>{msg.severity.toUpperCase()}</span>
          </p>
          <pre>{msg.body}</pre>
        </article>
      ))}
    </aside>
  );
}
