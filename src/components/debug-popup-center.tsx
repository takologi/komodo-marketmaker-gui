"use client";

import { useEffect, useMemo, useState } from "react";

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
  data?: DebugMessage[];
}

const POLL_MS = 1500;

export function DebugPopupCenter() {
  const [messages, setMessages] = useState<DebugMessage[]>([]);

  useEffect(() => {
    let active = true;

    const fetchMessages = async () => {
      try {
        const response = await fetch("/api/debug/messages?limit=50", { cache: "no-store" });
        const payload = (await response.json()) as DebugMessageApiResponse;
        if (!active || !payload.ok || !payload.data || payload.data.length === 0) {
          return;
        }

        setMessages((prev) => {
          const next = [...prev, ...payload.data!];
          return next.slice(-40);
        });
      } catch {
        // Silent by design; this is best-effort diagnostics UI.
      }
    };

    void fetchMessages();
    const timer = setInterval(() => void fetchMessages(), POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <aside className="debug-popups" aria-live="polite" aria-label="Debug popups">
      {ordered.map((msg) => (
        <article key={msg.id} className={`debug-popup severity-${msg.severity}`}>
          <header>
            <strong>{msg.title}</strong>
            <button
              type="button"
              onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
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
