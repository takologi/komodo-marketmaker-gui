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

  return callKdfRpc<JsonValue>(activationMethod, payload);
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
