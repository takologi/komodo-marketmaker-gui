import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";

const sourceBackoffUntilMs = new Map<string, number>();

function parseRetryAfterMs(raw: string | null): number | undefined {
  if (!raw) return undefined;

  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.floor(asSeconds * 1000);
  }

  const at = Date.parse(raw);
  if (Number.isFinite(at)) {
    const delta = at - Date.now();
    if (delta > 0) return delta;
  }

  return undefined;
}

function parseNumberHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function setSourceBackoff(sourceId: string, durationMs: number) {
  const now = Date.now();
  const until = now + Math.max(1_000, durationMs);
  const prev = sourceBackoffUntilMs.get(sourceId) ?? 0;
  if (until > prev) {
    sourceBackoffUntilMs.set(sourceId, until);
  }
}

export async function waitForSourceThrottleWindow(sourceId: string): Promise<void> {
  const until = sourceBackoffUntilMs.get(sourceId);
  if (!until) return;

  const now = Date.now();
  const delayMs = until - now;
  if (delayMs <= 0) return;

  await logDebugEvent({
    severity: "warning",
    title: "KCB reference price throttling backoff",
    body: `Delaying source ${sourceId} by ${delayMs}ms due to previous throttling`,
    details: { sourceId, delayMs, until },
  });

  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Detect potential throttling from response status/headers and register a backoff window.
 * Includes an explicit warning log entry whenever throttling is detected.
 */
export async function detectAndHandlePotentialThrottling(params: {
  sourceId: string;
  status: number;
  headers: Headers;
}): Promise<void> {
  const { sourceId, status, headers } = params;

  const retryAfterMs = parseRetryAfterMs(headers.get("retry-after"));
  const remaining = parseNumberHeader(headers.get("x-ratelimit-remaining"));
  const resetEpoch = parseNumberHeader(headers.get("x-ratelimit-reset"));

  let throttled = false;
  let reason = "none";
  let backoffMs = 0;

  if (status === 429) {
    throttled = true;
    reason = "http_429";
    backoffMs = retryAfterMs ?? 60_000;
  } else if (remaining !== undefined && remaining <= 0) {
    throttled = true;
    reason = "rate_limit_remaining_zero";
    if (resetEpoch !== undefined) {
      const resetMs = resetEpoch > 10_000_000_000 ? resetEpoch : resetEpoch * 1000;
      backoffMs = Math.max(1_000, resetMs - Date.now());
    } else {
      backoffMs = retryAfterMs ?? 30_000;
    }
  } else if (retryAfterMs !== undefined && retryAfterMs > 0) {
    throttled = true;
    reason = "retry_after_header";
    backoffMs = retryAfterMs;
  }

  if (!throttled) return;

  setSourceBackoff(sourceId, backoffMs);

  await logDebugEvent({
    severity: "warning",
    title: "KCB reference price throttling detected",
    body: `Potential throttling detected for source ${sourceId}; applying ${backoffMs}ms backoff`,
    details: {
      sourceId,
      status,
      reason,
      backoffMs,
      retryAfter: headers.get("retry-after"),
      rateLimitRemaining: headers.get("x-ratelimit-remaining"),
      rateLimitReset: headers.get("x-ratelimit-reset"),
    },
  });
}
