import "server-only";

import { DebugSeverity, normalizeSeverity } from "@/lib/debug/severity";

interface RuntimeDebugLevels {
  messageLevel: DebugSeverity;
  logLevel: DebugSeverity;
}

const runtimeLevels: RuntimeDebugLevels = {
  messageLevel: normalizeSeverity(process.env.DEBUG_MESSAGE_LEVEL, "error"),
  logLevel: normalizeSeverity(process.env.DEBUG_LOG_LEVEL, "warning"),
};

export function getRuntimeDebugLevels(): RuntimeDebugLevels {
  return { ...runtimeLevels };
}

export function setRuntimeDebugLevels(input: {
  messageLevel?: string;
  logLevel?: string;
}): RuntimeDebugLevels {
  if (input.messageLevel !== undefined) {
    runtimeLevels.messageLevel = normalizeSeverity(input.messageLevel, runtimeLevels.messageLevel);
  }

  if (input.logLevel !== undefined) {
    runtimeLevels.logLevel = normalizeSeverity(input.logLevel, runtimeLevels.logLevel);
  }

  return { ...runtimeLevels };
}
