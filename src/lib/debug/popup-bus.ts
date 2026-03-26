import "server-only";

import { DebugMessage, DebugSeverity } from "@/lib/debug/severity";

const MAX_QUEUE_SIZE = 200;
const queue: DebugMessage[] = [];

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sendMessageToClient(input: {
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

export function consumeClientMessages(limit = 50): DebugMessage[] {
  const boundedLimit = Math.max(1, Math.min(limit, 200));
  const items = queue.splice(0, boundedLimit);
  return items;
}
