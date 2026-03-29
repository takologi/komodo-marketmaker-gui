import "server-only";

import { DebugMessage, DebugSeverity } from "@/lib/debug/severity";

const MAX_QUEUE_SIZE = 1000;
const queue: DebugMessage[] = [];

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function enqueueLogWindowMessage(input: {
  timestamp?: string;
  severity: DebugSeverity;
  title: string;
  body: string;
}): DebugMessage {
  const message: DebugMessage = {
    id: nextId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    severity: input.severity,
    title: input.title,
    body: input.body,
  };

  queue.push(message);
  if (queue.length > MAX_QUEUE_SIZE) {
    queue.splice(0, queue.length - MAX_QUEUE_SIZE);
  }

  return message;
}

export function consumeLogWindowMessages(limit = 200): DebugMessage[] {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_QUEUE_SIZE));
  return queue.splice(0, boundedLimit);
}
