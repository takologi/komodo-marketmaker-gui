"use client";

import { useEffect, useRef, useState } from "react";

type DebugSeverity = "critical" | "error" | "warning" | "info" | "debug" | "trace";

interface DebugLogMessage {
  id: string;
  timestamp: string;
  severity: DebugSeverity;
  title: string;
  body: string;
}

interface DebugLogWindowResponse {
  ok: boolean;
  enabled: boolean;
  level: DebugSeverity;
  data: DebugLogMessage[];
}

const POLL_MS = 1000;

export function DebugLogWindow() {
  const [enabled, setEnabled] = useState(false);
  const [messages, setMessages] = useState<DebugLogMessage[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const fetchMessages = async () => {
      try {
        const res = await fetch("/api/debug/log-window?limit=250", { cache: "no-store" });
        const payload = (await res.json()) as DebugLogWindowResponse;
        if (!active || !payload.ok) return;

        setEnabled(payload.enabled);

        if (!payload.enabled || !payload.data || payload.data.length === 0) {
          return;
        }

        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const incoming = payload.data.filter((m) => !known.has(m.id));
          if (incoming.length === 0) return prev;
          return [...prev, ...incoming];
        });
      } catch {
        // silent by design
      }
    };

    void fetchMessages();
    const timer = setInterval(() => void fetchMessages(), POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const node = viewportRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, enabled]);

  if (!enabled) return null;

  return (
    <section className="debug-log-window" aria-label="Debug log window">
      <div className="debug-log-window-toolbar">
        <strong>Live debug log</strong>
        <button
          type="button"
          onClick={() => setMessages([])}
          className="debug-log-window-clear"
        >
          Clear log messages
        </button>
      </div>

      <div className="debug-log-window-viewport" ref={viewportRef}>
        {messages.map((msg) => (
          <p key={msg.id} className={`severity-${msg.severity}`}>
            {msg.timestamp} - [{msg.severity}] - <b>{msg.title}</b> - {msg.body}
          </p>
        ))}
      </div>
    </section>
  );
}
