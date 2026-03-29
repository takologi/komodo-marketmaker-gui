import "server-only";

import { DebugSeverity, normalizeSeverity } from "@/lib/debug/severity";

interface RuntimeDebugLevels {
  messageLevel: DebugSeverity;
  logLevel: DebugSeverity;
  logWindowEnabled: boolean;
}

function normalizeBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const runtimeLevels: RuntimeDebugLevels = {
  messageLevel: normalizeSeverity(process.env.DEBUG_MESSAGE_LEVEL, "error"),
  logLevel: normalizeSeverity(process.env.DEBUG_LOG_LEVEL, "warning"),
  logWindowEnabled: normalizeBool(process.env.DEBUG_LOG_WINDOW_ENABLED, false),
};

export function getRuntimeDebugLevels(): RuntimeDebugLevels {
  return { ...runtimeLevels };
}

export function setRuntimeDebugLevels(input: {
  messageLevel?: string;
  logLevel?: string;
  logWindowEnabled?: boolean;
}): RuntimeDebugLevels {
  if (input.messageLevel !== undefined) {
    runtimeLevels.messageLevel = normalizeSeverity(input.messageLevel, runtimeLevels.messageLevel);
  }

  if (input.logLevel !== undefined) {
    runtimeLevels.logLevel = normalizeSeverity(input.logLevel, runtimeLevels.logLevel);
  }

  if (input.logWindowEnabled !== undefined) {
    runtimeLevels.logWindowEnabled = Boolean(input.logWindowEnabled);
  }

  return { ...runtimeLevels };
}
