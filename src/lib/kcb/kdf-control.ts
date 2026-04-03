import "server-only";

import { logDebugEvent } from "@/lib/debug/logger";
import { fetchSimpleMmStatusOptional, callKdfRpc } from "@/lib/kdf/client";
import { JsonObject, JsonValue } from "@/lib/kdf/types";
import { triggerRestart } from "@/lib/system/restart";

export async function activateCoin(
  coin: string,
  activationMethod: string,
  params: JsonObject,
): Promise<JsonValue> {
  const payload: JsonObject = {
    coin,
    ...params,
  };

  await logDebugEvent({
    severity: "info",
    title: "KCB activate coin",
    body: `Activating coin=${coin} via ${activationMethod}`,
    details: payload,
  });

  try {
    return await callKdfRpc<JsonValue>(activationMethod, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already\s+initialized/i.test(message)) {
      await logDebugEvent({
        severity: "debug",
        title: "KCB coin activation already initialized",
        body: `Coin ${coin} is already initialized; treating activation as idempotent success`,
        details: {
          coin,
          activationMethod,
          message,
        },
      });
      return { result: "already_initialized" };
    }
    throw error;
  }
}

export async function startSimpleMmIfNeeded(startPayload?: JsonObject): Promise<JsonValue | null> {
  const status = await fetchSimpleMmStatusOptional();
  if (status.available && status.raw) {
    const state = String(status.raw.bot_state ?? status.raw.state ?? status.raw.status ?? "").toLowerCase();
    if (["running", "active", "ok"].includes(state)) {
      await logDebugEvent({
        severity: "debug",
        title: "KCB simple MM start skipped",
        body: "Simple MM appears active; skipping start command for idempotency",
      });
      return null;
    }
  }

  const params = startPayload ?? {};
  try {
    return await callKdfRpc<JsonValue>("start_simple_market_maker_bot", params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/already\s*started/i.test(message)) {
      await logDebugEvent({
        severity: "debug",
        title: "KCB simple MM already started",
        body: "start_simple_market_maker_bot returned AlreadyStarted; treating as idempotent success",
        details: { message },
      });
      return null;
    }
    throw error;
  }
}

export async function restartKdfViaSystem(): Promise<string> {
  return triggerRestart();
}

/**
 * Poll KDF until it responds to an RPC call or the timeout elapses.
 *
 * systemctl restart returns as soon as the unit's start job completes
 * (the process was spawned), but KDF needs several seconds to initialise
 * its RPC listener. Calling apply_bootstrap immediately after restart
 * would hit a booting KDF and fail. This function bridges that gap.
 *
 * Any non-network error (e.g. "method not found") is treated as
 * "KDF is up" — the process answered, which is all we need.
 */
export async function waitForKdfReady(
  maxWaitMs = 30_000,
  intervalMs = 1_500,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      await callKdfRpc("get_enabled_coins", {});
      await logDebugEvent({
        severity: "debug",
        title: "KDF ready",
        body: "KDF responded to readiness probe",
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isNetworkError = /unreachable|ECONNREFUSED|ENOTFOUND|fetch failed|AbortError|timed out/i.test(message);

      if (!isNetworkError) {
        // KDF answered with an application-level error — it is up.
        await logDebugEvent({
          severity: "debug",
          title: "KDF ready (method error)",
          body: "KDF returned a non-network error during readiness probe — treating as ready",
          details: { message },
        });
        return;
      }

      await logDebugEvent({
        severity: "debug",
        title: "KDF not ready yet",
        body: "KDF probe failed with network error; retrying",
        details: { message, remainingMs: deadline - Date.now() },
      });
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }

  await logDebugEvent({
    severity: "warning",
    title: "KDF readiness timeout",
    body: `KDF did not respond within ${maxWaitMs}ms after restart; bootstrap apply will proceed and may fail`,
    details: { maxWaitMs },
  });
}
